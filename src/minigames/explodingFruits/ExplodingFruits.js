import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions } from '../sharedSteps.js';

/**
 * Exploding Fruits - a bomb suddenly marks a random living player (no key
 * press triggers it - it's entirely external, matching "you don't
 * generate the watermelon, it just appears"). It tracks that player
 * briefly as a warning telegraph, then drops and arms at that fixed spot:
 * from then on the danger zone doesn't move, so running away is a real,
 * learnable escape rather than an unavoidable chase. On detonation it
 * leaves a permanent crater that's lethal to fall into, so the safe area
 * of the arena only ever shrinks over the course of a round. Both spawn
 * rate and how many bombs can be live at once scale with ChaosDirector's
 * intensity.
 */
export class ExplodingFruits extends MinigameBase {
  onStart() {
    this.bombs = [];
    this.craters = [];
    this.spawnTimer = this.rng.range(this.config.spawn.minInterval, this.config.spawn.maxInterval);
  }

  update(dt, inputs) {
    stepPlayersMovement(this.players, inputs, this.arena, dt, this.config.movement);
    stepPlayerCollisions(this.players, this.config.playerRestitution);
    this.updateBombs(dt);
    this.checkCraters();
  }

  updateBombs(dt) {
    const maxActive = Math.min(this.config.maxBombsBase + Math.floor(this.chaos.intensity), this.config.maxBombsCap);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.bombs.length < maxActive) {
      this.trySpawnBomb();
      this.spawnTimer = this.rng.range(this.config.spawn.minInterval, this.config.spawn.maxInterval) / this.chaos.intensity;
    }

    for (const bomb of this.bombs) {
      if (bomb.phase === 'marked') {
        // Still tracking its target during the brief warning telegraph.
        const target = this.players.find((p) => p.id === bomb.targetId);
        if (target && target.alive) {
          bomb.x = target.x;
          bomb.y = target.y;
        }
        bomb.timer -= dt;
        if (bomb.timer <= 0) {
          bomb.phase = 'armed';
          bomb.timer = this.config.fuseTime;
        }
      } else if (bomb.phase === 'armed') {
        // Armed bombs are fixed in place - the target already had their
        // warning, now it's about running away from a known spot.
        bomb.timer -= dt;
        bomb.blastPreview = 1 - Math.max(0, bomb.timer / this.config.fuseTime);
        if (bomb.timer <= 0) this.detonate(bomb);
      }
    }
    this.bombs = this.bombs.filter((b) => b.phase !== 'done');
  }

  trySpawnBomb() {
    const alive = this.getAlivePlayers();
    if (!alive.length) return;
    const target = this.rng.pick(alive);
    this.bombs.push({ targetId: target.id, x: target.x, y: target.y, phase: 'marked', timer: this.config.markDuration, blastPreview: 0 });
  }

  detonate(bomb) {
    bomb.phase = 'done';
    this.craters.push({ x: bomb.x, y: bomb.y, radius: this.config.blastRadius });
    for (const p of this.getAlivePlayers()) {
      const d = Math.hypot(p.x - bomb.x, p.y - bomb.y);
      if (d < this.config.blastRadius + p.radius * 0.5) {
        p.alive = false;
        this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'explodingFruits', reason: 'blast' });
      }
    }
  }

  /** Craters persist for the whole round and are lethal on overlap - this is
   * what makes the safe area shrink permanently as a round goes on. */
  checkCraters() {
    for (const p of this.getAlivePlayers()) {
      for (const c of this.craters) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < c.radius * this.config.craterLethalFactor) {
          p.alive = false;
          this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'explodingFruits', reason: 'crater' });
        }
      }
    }
  }

  getBotIntent(player) {
    let danger = null;
    let best = Infinity;
    for (const bomb of this.bombs) {
      if (bomb.phase === 'done') continue;
      const d = Math.hypot(bomb.x - player.x, bomb.y - player.y);
      const radiusOfConcern = bomb.phase === 'armed' ? this.config.blastRadius * 1.6 : this.config.botMarkAwareRadius;
      if (d < radiusOfConcern && d < best) {
        best = d;
        danger = bomb;
      }
    }
    if (danger) return { flee: danger };

    for (const c of this.craters) {
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < c.radius * this.config.botCraterAwareFactor) return { flee: c };
    }
    return null;
  }

  getDrawables() {
    const list = this.craters.map((c) => ({ type: 'crater', x: c.x, y: c.y, r: c.radius }));
    for (const b of this.bombs) {
      list.push({ type: 'bomb', x: b.x, y: b.y, phase: b.phase, blastPreview: b.blastPreview, blastRadius: this.config.blastRadius });
    }
    for (const p of this.getAlivePlayers()) list.push({ type: 'blob', x: p.x, y: p.y, r: p.radius, fill: p.color, face: true, label: p.name });
    return list;
  }
}
