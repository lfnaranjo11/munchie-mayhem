import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions } from '../sharedSteps.js';
import { distPointToSegment, applyHazardInfluence } from '../../core/Physics.js';

// The three escalation phases, shuffled into a random order each round -
// "randomness is not always the same order of the steps."
const PHASES = ['rotate', 'translateRotate', 'orbitAll'];

/**
 * Ketchin' Up - a ketchup emitter sweeps a laser beam around the arena.
 * Chocolate obstacles block the beam until it actually hits one, at which
 * point that obstacle launches away at high speed and can bounce off
 * players (harmlessly, just a shove/drag) and walls - only the beam
 * itself is lethal.
 *
 * The beam doesn't start fully lethal 100% of the time: early on it
 * PULSES on and off (see updateBeamAndObstacles), giving real gaps to
 * dash through. As the round progresses that duty cycle grows toward
 * "always on" - "less intermittent" - while three phases cycle through
 * in a random order, each one raising `speedMultiplier` a bit further:
 *   rotate          - beam spins in place around the emitter
 *   translateRotate - the emitter itself also drifts around the arena
 *   orbitAll        - every remaining (unstruck) obstacle also orbits the
 *                      arena's center, so cover keeps moving too
 * The obstacle layout (and which corner of the arena the action favours)
 * is randomized per round - "I don't think the map is always the same."
 */
export class KetchinUp extends MinigameBase {
  onStart() {
    const { rng, arena } = this;
    this.emitter = { x: arena.width / 2, y: arena.height / 2, angle: rng.range(0, Math.PI * 2) };
    this.obstacles = this.generateObstacles();
    this.flyingObstacles = [];
    this.phaseOrder = rng.shuffle([...PHASES]);
    this.phaseIndex = -1;
    this.speedMultiplier = 1;
    this.pulseClock = 0;
    this.beamIsLive = true;
    this.beamEnd = { x: this.emitter.x, y: this.emitter.y };
    this.advancePhase();
  }

  generateObstacles() {
    const { rng, arena, config } = this;
    const list = [];
    for (let i = 0; i < config.obstacleCount; i++) {
      list.push({ x: rng.range(100, arena.width - 100), y: rng.range(100, arena.height - 100), radius: config.obstacleRadius, struck: false });
    }
    return list;
  }

  advancePhase() {
    this.phaseIndex = (this.phaseIndex + 1) % this.phaseOrder.length;
    this.phase = this.phaseOrder[this.phaseIndex];
    this.phaseTimer = this.rng.range(this.config.phaseDuration.min, this.config.phaseDuration.max);
    this.speedMultiplier = Math.min(this.config.maxSpeedMultiplier, this.speedMultiplier + this.config.speedRampPerPhase);
  }

  update(dt, inputs) {
    stepPlayersMovement(this.players, inputs, this.arena, dt, this.config.movement);
    stepPlayerCollisions(this.players, this.config.playerRestitution);
    this.updateFlyingObstacles(dt);

    this.phaseTimer -= dt;
    if (this.phaseTimer <= 0) this.advancePhase();

    this.updateEmitter(dt);
    this.updateBeamAndObstacles(dt);
  }

  updateEmitter(dt) {
    const cfg = this.config;
    const speed = this.speedMultiplier * this.chaos.intensity;
    const angularFactor = this.phase === 'rotate' ? 1 : cfg.secondaryAngularFactor;
    this.emitter.angle += cfg.baseAngularVelocity * speed * angularFactor * dt;

    if (this.phase === 'translateRotate') {
      this.emitter.x += Math.sin(this.emitter.angle * 0.5) * cfg.translateSpeed * speed * dt;
      this.emitter.y += Math.cos(this.emitter.angle * 0.7) * cfg.translateSpeed * speed * dt;
      this.emitter.x = Math.max(120, Math.min(this.arena.width - 120, this.emitter.x));
      this.emitter.y = Math.max(120, Math.min(this.arena.height - 120, this.emitter.y));
    }

    if (this.phase === 'orbitAll') {
      const cx = this.arena.width / 2;
      const cy = this.arena.height / 2;
      // Negative delta = counter-clockwise in screen space (y grows
      // downward, which flips the usual math-convention sign).
      const orbitDelta = -cfg.orbitAngularVelocity * speed * dt;
      for (const obs of this.obstacles) {
        if (obs.struck) continue;
        const dx = obs.x - cx;
        const dy = obs.y - cy;
        const angle = Math.atan2(dy, dx) + orbitDelta;
        const radius = Math.hypot(dx, dy);
        obs.x = cx + Math.cos(angle) * radius;
        obs.y = cy + Math.sin(angle) * radius;
      }
    }
  }

  updateBeamAndObstacles(dt) {
    const { emitter, config } = this;

    // Duty-cycle pulsing: the beam is only "live" (able to strike
    // anything) for `activeFraction` of each `pulsePeriod`-second cycle.
    // activeFraction grows with speedMultiplier, so later phases read as
    // "faster AND less intermittent" simultaneously.
    this.pulseClock = (this.pulseClock + dt) % config.pulse.period;
    const activeFraction = Math.min(1, config.pulse.baseActiveFraction + this.speedMultiplier * config.pulse.activeFractionGrowth);
    const beamIsLive = this.pulseClock < config.pulse.period * activeFraction;
    this.beamIsLive = beamIsLive;

    const dirX = Math.cos(emitter.angle);
    const dirY = Math.sin(emitter.angle);
    let blockDist = config.beamLength;
    let blocker = null;

    // While the beam is in its "off" pulse it's a harmless telegraph -
    // skip hit-testing entirely so it can't strike obstacles or players.
    if (beamIsLive) {
      for (const obs of this.obstacles) {
        if (obs.struck) continue;
        const toObsX = obs.x - emitter.x;
        const toObsY = obs.y - emitter.y;
        const proj = toObsX * dirX + toObsY * dirY; // distance along the beam
        if (proj < 0 || proj > config.beamLength) continue;
        const perp = Math.abs(toObsX * dirY - toObsY * dirX); // distance off the beam's axis
        if (perp <= obs.radius && proj < blockDist) {
          blockDist = proj;
          blocker = obs;
        }
      }
    }

    this.beamEnd = { x: emitter.x + dirX * blockDist, y: emitter.y + dirY * blockDist };

    if (beamIsLive && blocker) {
      blocker.struck = true;
      const speed = config.obstacleLaunchSpeed * this.speedMultiplier;
      this.flyingObstacles.push({ x: blocker.x, y: blocker.y, radius: blocker.radius, mass: config.obstacleMass, vx: dirX * speed, vy: dirY * speed });
    }

    if (beamIsLive) {
      for (const p of this.getAlivePlayers()) {
        const d = distPointToSegment(p.x, p.y, emitter.x, emitter.y, this.beamEnd.x, this.beamEnd.y);
        if (d < p.radius + config.beamWidth / 2) {
          p.alive = false;
          this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'ketchinUp' });
        }
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
      // Non-lethal on contact with players - just a bounce/drag, per the brief.
      for (const p of this.getAlivePlayers()) applyHazardInfluence(p, fo, this.config.flyingObstacleInfluence);
    }
  }

  getBotIntent(player) {
    let bestObs = null;
    let bestScore = Infinity;
    for (const obs of this.obstacles) {
      if (obs.struck) continue;
      const d = Math.hypot(obs.x - player.x, obs.y - player.y);
      if (d < bestScore) {
        bestScore = d;
        bestObs = obs;
      }
    }
    if (bestObs) {
      // Aim for a point just past the obstacle's far edge from the
      // emitter - i.e. tuck in behind it, not just walk toward its center.
      const dx = bestObs.x - this.emitter.x;
      const dy = bestObs.y - this.emitter.y;
      const len = Math.hypot(dx, dy) || 1;
      return { seek: { x: bestObs.x + (dx / len) * bestObs.radius * 1.6, y: bestObs.y + (dy / len) * bestObs.radius * 1.6 } };
    }
    return { flee: this.emitter };
  }

  getDrawables() {
    const list = [
      { type: 'beam', x1: this.emitter.x, y1: this.emitter.y, x2: this.beamEnd.x, y2: this.beamEnd.y, width: this.config.beamWidth, live: this.beamIsLive },
      { type: 'emitter', x: this.emitter.x, y: this.emitter.y },
    ];
    for (const obs of this.obstacles) if (!obs.struck) list.push({ type: 'chocoBlock', x: obs.x, y: obs.y, r: obs.radius });
    for (const fo of this.flyingObstacles) list.push({ type: 'chocoBlock', x: fo.x, y: fo.y, r: fo.radius, flying: true });
    for (const p of this.getAlivePlayers()) list.push({ type: 'blob', x: p.x, y: p.y, r: p.radius, fill: p.color, face: true, label: p.name });
    return list;
  }
}
