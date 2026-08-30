import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions } from '../sharedSteps.js';
import { applyHazardInfluence } from '../../core/Physics.js';
import { createHazard } from '../../core/Entity.js';

/**
 * Organic Disposal - a wall of grinder blades runs down the left edge of
 * the arena. Random bits of food drift in from the right at varying
 * angles and speeds; touching one bounces or drags you depending on the
 * angle of impact (see Physics.js applyHazardInfluence). Players also
 * bounce off each other, which can absolutely shove someone into the
 * blades. A gentle constant current pulls everyone left, so standing
 * still is never quite safe. Anything - player or hazard - that reaches
 * the grinder zone is eliminated/destroyed there.
 */
export class OrganicDisposal extends MinigameBase {
  onStart() {
    this.hazards = [];
    this.grindEffects = [];
    this.spawnTimer = this.rng.range(this.config.spawn.minInterval, this.config.spawn.maxInterval);
  }

  update(dt, inputs) {
    // The current pulls everyone toward the grinders before movement
    // input is integrated, so it's felt the same frame it's applied.
    if (this.config.currentForce) {
      for (const p of this.getAlivePlayers()) p.vx -= this.config.currentForce * dt;
    }
    stepPlayersMovement(this.players, inputs, this.arena, dt, this.config.movement, { clampLeft: false });
    stepPlayerCollisions(this.players, this.config.playerRestitution);

    this.updateHazards(dt);
    this.checkGrinder();
  }

  updateHazards(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnHazard();
      // Divided by chaos intensity: the longer nobody dies, the more
      // often food starts flying in.
      this.spawnTimer = this.rng.range(this.config.spawn.minInterval, this.config.spawn.maxInterval) / this.chaos.intensity;
    }

    for (const h of this.hazards) {
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      if (h.y < h.radius || h.y > this.arena.height - h.radius) h.vy *= -1;
    }

    // Hazards that reach the grinder get destroyed there too - "all the
    // food that comes from the right ends up grinded on the left" - with
    // a small puff instead of just vanishing. Anything that drifts fully
    // off the right edge (shouldn't normally happen, but defensively) is
    // just dropped.
    const survivors = [];
    for (const h of this.hazards) {
      if (h.x - h.radius < this.config.sawZoneWidth) {
        this.grindEffects.push({ x: this.config.sawZoneWidth, y: h.y, life: this.config.grindEffectLife, maxLife: this.config.grindEffectLife });
      } else if (h.x < this.arena.width + 200) {
        survivors.push(h);
      }
    }
    this.hazards = survivors;

    for (const fx of this.grindEffects) fx.life -= dt;
    this.grindEffects = this.grindEffects.filter((fx) => fx.life > 0);

    for (const p of this.getAlivePlayers()) {
      for (const h of this.hazards) applyHazardInfluence(p, h, this.config.hazardInfluence);
    }
  }

  spawnHazard() {
    const type = this.rng.pick(this.config.hazardTypes);
    const speed = this.rng.range(type.minSpeed, type.maxSpeed) * this.chaos.intensity;
    // Mostly leftward (PI = pointing in -x), with a random spread so it
    // isn't a perfectly flat volley every time.
    const angle = Math.PI + this.rng.range(-type.spreadAngle, type.spreadAngle);
    this.hazards.push(
      createHazard({
        x: this.arena.width + 40,
        y: this.rng.range(60, this.arena.height - 60),
        radius: type.radius,
        mass: type.mass,
        color: type.color,
        skin: type.id,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      })
    );
  }

  checkGrinder() {
    for (const p of this.getAlivePlayers()) {
      if (p.x - p.radius < this.config.sawZoneWidth) {
        p.alive = false;
        this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'organicDisposal' });
      }
    }
  }

  getBotIntent(player) {
    // Flee whatever's closest and dangerous; otherwise, stay clear of the grinder.
    let nearest = null;
    let best = Infinity;
    for (const h of this.hazards) {
      if (h.x < player.x - player.radius) continue; // already past us, ignore
      const d = Math.hypot(h.x - player.x, h.y - player.y);
      if (d < this.config.botDangerRadius && d < best) {
        best = d;
        nearest = h;
      }
    }
    if (nearest) return { flee: nearest };

    const safeX = this.config.sawZoneWidth + this.config.botSafeMargin;
    if (player.x < safeX) return { seek: { x: safeX + 100, y: player.y } };
    return null;
  }

  getDrawables() {
    const list = [{ type: 'sawWall', x: 0, y: 0, width: this.config.sawZoneWidth, height: this.arena.height }];
    for (const fx of this.grindEffects) list.push({ type: 'puff', x: fx.x, y: fx.y, life: fx.life, maxLife: fx.maxLife });
    for (const h of this.hazards) list.push({ type: 'blob', x: h.x, y: h.y, r: h.radius, fill: h.color, face: true });
    for (const p of this.getAlivePlayers()) list.push({ type: 'blob', x: p.x, y: p.y, r: p.radius, fill: p.color, face: true, label: p.name });
    return list;
  }
}
