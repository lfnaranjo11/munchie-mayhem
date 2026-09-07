import { easeOutQuad } from './easing.js';

/**
 * ParticleSystem.js - dust puffs, impact sparks, explosion debris, and
 * screen shake.
 *
 * Like everything under engine/anim, this is render-layer only: particles
 * never collide with anything and no game rule can see them. They're
 * spawned either from bus events (an explosion happened) or derived from
 * state changes the renderer notices (a character just bounced hard).
 *
 * POOLING: particles are allocated once and reused via an `alive` flag
 * rather than being created and garbage-collected constantly. At a few
 * hundred short-lived particles per second, naive allocation causes
 * visible GC hitches in long sessions - and a hitch in a twitchy party
 * game is worse than the effect is good.
 */

const DEFAULT_POOL_SIZE = 400;

export class ParticleSystem {
  constructor(poolSize = DEFAULT_POOL_SIZE) {
    this.pool = Array.from({ length: poolSize }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 4,
      color: '#fff',
      gravity: 0,
      drag: 0.94,
      shape: 'circle',
    }));
    this.cursor = 0;
  }

  /**
   * Grabs a free particle. If the pool is exhausted it overwrites the
   * oldest slot rather than growing - a hard cap on particle cost is worth
   * more than never dropping a puff, and at a full pool nobody can tell.
   */
  _acquire() {
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.cursor + i) % this.pool.length;
      if (!this.pool[idx].alive) {
        this.cursor = (idx + 1) % this.pool.length;
        return this.pool[idx];
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return p;
  }

  emit({ x, y, count = 6, speed = 60, spread = Math.PI * 2, angle = 0, life = 0.5, size = 4, color = '#fff', gravity = 0, drag = 0.94, shape = 'circle' }) {
    for (let i = 0; i < count; i++) {
      const p = this._acquire();
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.5 + Math.random() * 0.7);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = life * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = color;
      p.gravity = gravity;
      p.drag = drag;
      p.shape = shape;
    }
  }

  /** Dust kicked up behind a running character. */
  emitDust(x, y, dirX, dirY, color = 'rgba(255,255,255,0.85)') {
    this.emit({
      x,
      y,
      count: 2,
      // Fires opposite the direction of travel, like kicked-up dirt.
      angle: Math.atan2(-dirY, -dirX),
      spread: 0.8,
      speed: 45,
      life: 0.35,
      size: 3.5,
      color,
      drag: 0.9,
    });
  }

  emitImpact(x, y, color = '#fff') {
    this.emit({ x, y, count: 8, speed: 130, life: 0.35, size: 3, color, drag: 0.86 });
  }

  emitExplosion(x, y) {
    this.emit({ x, y, count: 22, speed: 200, life: 0.6, size: 6, color: '#ffce54', drag: 0.88 });
    this.emit({ x, y, count: 14, speed: 140, life: 0.8, size: 8, color: 'rgba(90,80,70,0.75)', drag: 0.9 });
  }

  emitPoof(x, y, color = '#fff') {
    this.emit({ x, y, count: 16, speed: 110, life: 0.55, size: 5, color, drag: 0.87 });
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Emits drawable descriptors, same declarative contract minigames use. */
  getDrawables() {
    const out = [];
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      out.push({
        type: 'particle',
        x: p.x,
        y: p.y,
        // Shrink and fade out on an eased curve so particles dissolve
        // rather than blinking out of existence.
        r: p.size * easeOutQuad(t),
        alpha: Math.min(1, t * 1.5),
        fill: p.color,
        shape: p.shape,
      });
    }
    return out;
  }

  clear() {
    for (const p of this.pool) p.alive = false;
  }
}

/**
 * ScreenShake - a decaying random offset applied to the whole view.
 *
 * Trauma-based rather than "shake for N seconds": callers add trauma,
 * which decays continuously, and the actual offset is trauma^2. Squaring
 * means small trauma is almost invisible while large trauma is violent,
 * and repeated hits accumulate smoothly instead of restarting a timer.
 */
export class ScreenShake {
  constructor({ decay = 1.6, maxOffset = 14, maxTrauma = 1 } = {}) {
    this.trauma = 0;
    this.decay = decay;
    this.maxOffset = maxOffset;
    this.maxTrauma = maxTrauma;
  }

  add(amount) {
    this.trauma = Math.min(this.maxTrauma, this.trauma + amount);
  }

  update(dt) {
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }

  getOffset() {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const magnitude = this.trauma * this.trauma * this.maxOffset;
    return {
      x: (Math.random() * 2 - 1) * magnitude,
      y: (Math.random() * 2 - 1) * magnitude,
    };
  }

  reset() {
    this.trauma = 0;
  }
}
