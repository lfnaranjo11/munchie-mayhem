import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions } from '../sharedSteps.js';
import { distPointToSegment, applyHazardInfluence } from '../../core/Physics.js';

/**
 * Ketchin' Up - a ketchup cannon sweeping a lethal beam around the board.
 *
 * ── THE RHYTHM (this is the whole minigame) ──────────────────────────
 * The first version spun the beam continuously and quickly, with a short
 * duty-cycle blink. That was boring in the worst way: with danger
 * everywhere all the time there was no moment to breathe, no decision to
 * make and nothing to anticipate - just constant low-grade dodging.
 * Threat with no release stops registering as threat.
 *
 * The beam now runs an explicit three-beat cycle:
 *
 *   CHARGE  visible but harmless - a thin line marking exactly where it
 *           will fire. This is the "get out of the way" beat, and the
 *           telegraph is the fun part.
 *   FIRE    lethal, short, and sweeping slowly enough that you can read
 *           where it is heading and outrun it.
 *   COOL    completely off. No line, no danger. Long enough to move to
 *           better cover or shove somebody into the open.
 *
 * Every few cycles the cannon REPOSITIONS: the beam stays off entirely
 * and the emitter dashes across the board. That is the big release beat -
 * the arena is briefly safe and everyone scrambles to re-establish cover
 * before the next charge. The dash is long and fast on purpose; a cannon
 * that only nudged itself a little made the whole arena feel static.
 *
 * Sweeps speed up slightly each cycle so the round still escalates, but
 * from a far slower base than before. The pressure comes from rhythm and
 * position now, not from raw angular speed.
 */
const VARIATIONS = ['plain', 'orbit', 'reverse'];

export class KetchinUp extends MinigameBase {
  onStart() {
    const { rng, arena } = this;

    this.emitter = { x: arena.width / 2, y: arena.height / 2, angle: rng.range(0, Math.PI * 2) };
    this.obstacles = this.generateObstacles();
    this.flyingObstacles = [];

    // Start cool, so nobody dies to a beam that was already firing before
    // they had a chance to look at the screen.
    this.beamPhase = 'cool';
    this.phaseTimer = this.config.beam.openingCalm;
    this.cycleCount = 0;
    this.rotationSpeed = this.config.rotation.baseSpeed;

    this.repositioning = false;
    this.repositionTarget = null;
    this.variation = 'plain';

    this.beamEnd = { x: this.emitter.x, y: this.emitter.y };
  }

  generateObstacles() {
    const { rng, arena, config } = this;
    const list = [];
    for (let i = 0; i < config.obstacleCount; i++) {
      list.push({
        x: rng.range(100, arena.width - 100),
        y: rng.range(100, arena.height - 100),
        radius: config.obstacleRadius,
        struck: false,
      });
    }
    return list;
  }

  update(dt, inputs) {
    stepPlayersMovement(this.players, inputs, this.arena, dt, this.config.movement);
    stepPlayerCollisions(this.players, this.config.playerRestitution);
    this.updateFlyingObstacles(dt);

    if (this.repositioning) this.updateReposition(dt);
    else this.updateSweep(dt);

    this.updateBeamGeometry();
  }

  /**
   * The cannon dashing to a new spot with the beam off - deliberately the
   * only time the board is completely safe.
   *
   * Travel is at constant speed rather than over a fixed duration, so a
   * longer move genuinely takes longer and the calm lasts in proportion
   * to the distance covered.
   */
  updateReposition(dt) {
    const { config } = this;
    const dx = this.repositionTarget.x - this.emitter.x;
    const dy = this.repositionTarget.y - this.emitter.y;
    const dist = Math.hypot(dx, dy);
    const step = config.reposition.travelSpeed * dt;

    if (dist <= step) {
      this.emitter.x = this.repositionTarget.x;
      this.emitter.y = this.repositionTarget.y;
      this.repositioning = false;
      // A beat of stillness on arrival, so the first charge after a move
      // isn't an instant ambush.
      this.beamPhase = 'cool';
      this.phaseTimer = config.reposition.settleTime;
      return;
    }

    this.emitter.x += (dx / dist) * step;
    this.emitter.y += (dy / dist) * step;
    // Spin lazily while travelling: reads as a machine winding up, and
    // randomises which way it will be aiming when it arrives.
    this.emitter.angle += config.reposition.spinSpeed * dt;
  }

  /** Rotating in place, cycling charge -> fire -> cool. */
  updateSweep(dt) {
    const { config } = this;

    // Slowest while firing - that is when reading the beam's path matters
    // most. Faster while cooling, to re-aim between shots.
    const speed =
      this.beamPhase === 'fire'
        ? this.rotationSpeed
        : this.beamPhase === 'charge'
          ? this.rotationSpeed * config.rotation.chargeFactor
          : this.rotationSpeed * config.rotation.coolFactor;

    const direction = this.variation === 'reverse' ? -1 : 1;
    this.emitter.angle += speed * direction * this.chaos.intensity * dt;

    if (this.variation === 'orbit') this.orbitObstacles(dt);

    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) this.advancePhase();
  }

  advancePhase() {
    const { config, rng } = this;

    if (this.beamPhase === 'cool') {
      this.beamPhase = 'charge';
      this.phaseTimer = config.beam.chargeTime;
      return;
    }

    if (this.beamPhase === 'charge') {
      this.beamPhase = 'fire';
      this.phaseTimer = config.beam.fireTime;
      return;
    }

    // Just finished firing.
    this.beamPhase = 'cool';
    this.phaseTimer = config.beam.coolTime;
    this.cycleCount += 1;
    // Escalate gently. The round should tighten without drifting back to
    // the constant-danger version this replaced.
    this.rotationSpeed = Math.min(config.rotation.maxSpeed, this.rotationSpeed + config.rotation.rampPerCycle);

    if (this.cycleCount % config.reposition.everyCycles === 0) {
      this.startReposition();
      // Fresh variation for the next stretch, so the order of behaviours
      // differs every round rather than following a fixed script.
      this.variation = rng.pick(VARIATIONS);
    }
  }

  /**
   * Picks somewhere genuinely far to move to.
   *
   * Sampling and taking the furthest candidate (rather than any random
   * point) guarantees the dash actually crosses the board. A short hop
   * would waste the one beat where the arena is safe.
   */
  startReposition() {
    const { rng, arena, config } = this;
    const margin = 110;
    let best = null;
    let bestDist = -Infinity;

    for (let i = 0; i < config.reposition.candidates; i++) {
      const x = rng.range(margin, arena.width - margin);
      const y = rng.range(margin, arena.height - margin);
      const d = Math.hypot(x - this.emitter.x, y - this.emitter.y);
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }

    this.repositioning = true;
    this.repositionTarget = best;
    this.beamPhase = 'cool';
  }

  orbitObstacles(dt) {
    const cx = this.arena.width / 2;
    const cy = this.arena.height / 2;
    // Negative = counter-clockwise on screen (y grows downward).
    const delta = -this.config.orbitAngularVelocity * this.chaos.intensity * dt;
    for (const obs of this.obstacles) {
      if (obs.struck) continue;
      const dx = obs.x - cx;
      const dy = obs.y - cy;
      const angle = Math.atan2(dy, dx) + delta;
      const radius = Math.hypot(dx, dy);
      obs.x = cx + Math.cos(angle) * radius;
      obs.y = cy + Math.sin(angle) * radius;
    }
  }

  /** Lethal ONLY while firing. Charging and cooling are harmless. */
  isBeamLethal() {
    return !this.repositioning && this.beamPhase === 'fire';
  }

  /** Drawn dim while charging and bright while firing. During cooldown
   * and repositioning there is no beam on screen at all. */
  isBeamVisible() {
    return !this.repositioning && this.beamPhase !== 'cool';
  }

  /** Works out where the beam stops and applies its effects. */
  updateBeamGeometry() {
    const { emitter, config } = this;
    const dirX = Math.cos(emitter.angle);
    const dirY = Math.sin(emitter.angle);

    let blockDist = config.beamLength;
    let blocker = null;

    if (this.isBeamVisible()) {
      for (const obs of this.obstacles) {
        if (obs.struck) continue;
        const toObsX = obs.x - emitter.x;
        const toObsY = obs.y - emitter.y;
        const proj = toObsX * dirX + toObsY * dirY; // distance along the beam
        if (proj < 0 || proj > config.beamLength) continue;
        const perp = Math.abs(toObsX * dirY - toObsY * dirX); // distance off-axis
        if (perp <= obs.radius && proj < blockDist) {
          blockDist = proj;
          blocker = obs;
        }
      }
    }

    this.beamEnd = { x: emitter.x + dirX * blockDist, y: emitter.y + dirY * blockDist };

    if (!this.isBeamLethal()) return;

    // Only a firing beam launches cover or eliminates anyone.
    if (blocker) {
      blocker.struck = true;
      const speed = config.obstacleLaunchSpeed;
      this.flyingObstacles.push({
        x: blocker.x,
        y: blocker.y,
        radius: blocker.radius,
        mass: config.obstacleMass,
        vx: dirX * speed,
        vy: dirY * speed,
      });
    }

    for (const p of this.getAlivePlayers()) {
      const d = distPointToSegment(p.x, p.y, emitter.x, emitter.y, this.beamEnd.x, this.beamEnd.y);
      if (d < p.radius + config.beamWidth / 2) {
        p.alive = false;
        this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'ketchinUp' });
      }
    }
  }

  updateFlyingObstacles(dt) {
    for (const fo of this.flyingObstacles) {
      fo.x += fo.vx * dt;
      fo.y += fo.vy * dt;
      if (fo.x < fo.radius || fo.x > this.arena.width - fo.radius) fo.vx *= -0.85;
      if (fo.y < fo.radius || fo.y > this.arena.height - fo.radius) fo.vy *= -0.85;
      fo.x = Math.max(fo.radius, Math.min(this.arena.width - fo.radius, fo.x));
      fo.y = Math.max(fo.radius, Math.min(this.arena.height - fo.radius, fo.y));
      // Harmless on contact - just a shove, per the original design.
      for (const p of this.getAlivePlayers()) applyHazardInfluence(p, fo, this.config.flyingObstacleInfluence);
    }
  }

  getBotIntent(player) {
    // Bots use the safe beats the way a good player would: get behind
    // cover before the next charge, rather than reacting late.
    let bestObs = null;
    let bestDist = Infinity;
    for (const obs of this.obstacles) {
      if (obs.struck) continue;
      const d = Math.hypot(obs.x - player.x, obs.y - player.y);
      if (d < bestDist) {
        bestDist = d;
        bestObs = obs;
      }
    }

    if (bestObs) {
      // Tuck in behind the obstacle relative to the cannon, not on top of it.
      const dx = bestObs.x - this.emitter.x;
      const dy = bestObs.y - this.emitter.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        seek: {
          x: bestObs.x + (dx / len) * bestObs.radius * 1.7,
          y: bestObs.y + (dy / len) * bestObs.radius * 1.7,
        },
      };
    }
    return { flee: this.emitter };
  }

  getDrawables() {
    const list = [];

    if (this.isBeamVisible()) {
      list.push({
        id: 'beam',
        type: 'beam',
        x1: this.emitter.x,
        y1: this.emitter.y,
        x2: this.beamEnd.x,
        y2: this.beamEnd.y,
        width: this.config.beamWidth,
        live: this.isBeamLethal(),
        // 0..1 through the charge, so the renderer can build tension.
        charge: this.beamPhase === 'charge' ? 1 - this.phaseTimer / this.config.beam.chargeTime : 1,
      });
    }

    list.push({
      id: 'emitter',
      type: 'emitter',
      x: this.emitter.x,
      y: this.emitter.y,
      angle: this.emitter.angle,
      phase: this.repositioning ? 'moving' : this.beamPhase,
    });

    for (const obs of this.obstacles) {
      if (!obs.struck) list.push({ type: 'chocoBlock', x: obs.x, y: obs.y, r: obs.radius });
    }
    this.flyingObstacles.forEach((fo, i) =>
      list.push({ id: `fly_${i}`, type: 'chocoBlock', x: fo.x, y: fo.y, r: fo.radius, flying: true })
    );

    for (const p of this.getAlivePlayers()) {
      list.push({
        type: 'blob',
        id: p.id,
        characterId: p.characterId,
        x: p.x,
        y: p.y,
        r: p.radius,
        fill: p.color,
        face: true,
        label: p.name,
      });
    }
    return list;
  }
}
