import { stepSpring, approach } from './easing.js';

/**
 * VisualState.js - the animation state for one character.
 *
 * ── THE KEY ARCHITECTURAL RULE ────────────────────────────────────────
 * Every value in here is DERIVED from game state in the render layer and
 * stored only here. Nothing in this file is ever read back by physics,
 * minigame rules, or bots. That matters for three concrete reasons:
 *
 *   1. Determinism survives. Animation uses wall-clock deltas and
 *      Math.random() for things like blink timing; if any of that fed
 *      back into the simulation it would break the seeded-RNG guarantee
 *      (see core/RNG.js) and the lockstep multiplayer plan with it.
 *      Because it's one-way, animation can be as loose as it likes.
 *   2. Headless tests keep working - test/smoke.mjs never constructs
 *      these, and the simulation doesn't miss them.
 *   3. You can throw all of it away and swap in sprite sheets or a
 *      skeletal runtime without touching a single line of gameplay code.
 *
 * Using Math.random() here is therefore deliberate, not an oversight -
 * it's cosmetic-only jitter that must NOT come from the seeded game RNG.
 */

/** Facial expressions, chosen per-frame from context (see resolveExpression). */
export const EXPRESSION = {
  NEUTRAL: 'neutral',
  HAPPY: 'happy',
  SCARED: 'scared',
  DIZZY: 'dizzy',
  DETERMINED: 'determined',
};

export class VisualState {
  constructor() {
    // Squash/stretch, as a spring so collisions can knock it any frame and
    // it recovers continuously rather than restarting a fixed animation.
    this.squash = { value: 0, velocity: 0 };
    this.tilt = { value: 0, velocity: 0 };

    // Blinking: mostly-closed eyes for a few frames at random intervals.
    // A tiny detail that does a disproportionate amount of work in making
    // a face read as alive rather than as a drawing.
    this.blinkTimer = 1 + Math.random() * 3;
    this.blinkAmount = 0;

    // Continuous idle bob, so a stationary character is never perfectly
    // still (perfect stillness is the fastest way to look like a sprite
    // rather than a creature).
    this.bobPhase = Math.random() * Math.PI * 2;
    this.bob = 0;

    this.expression = EXPRESSION.NEUTRAL;
    this.facingX = 1;
    this.lastSpeed = 0;
    this.spawnAge = 0;
  }

  /**
   * Advances one render frame from the entity's current game state.
   *
   * @param {object} entity the player/hazard (read-only here)
   * @param {number} dt seconds since last render frame
   * @param {object} ctx contextual flags from the minigame, e.g.
   *   { onFire, crowned, inDanger, maxSpeed }
   * @param {object} cfg tuning (see config/characters.js `animation`)
   */
  update(entity, dt, ctx, cfg) {
    const dtScale = dt * 60;
    this.spawnAge += dt;

    const speed = Math.hypot(entity.vx, entity.vy);
    const speedNorm = Math.min(speed / (ctx.maxSpeed || 250), 1.6);

    // --- Squash & stretch -------------------------------------------------
    // Target stretch scales with speed: a fast-moving character elongates
    // along its direction of travel. A sudden DROP in speed (a bounce off
    // a wall or another player) instead kicks a squash impulse in, which
    // is what sells an impact.
    const deceleration = Math.max(0, this.lastSpeed - speed);
    if (deceleration > cfg.impactThreshold) {
      // Knock the spring; it'll oscillate back on its own.
      this.squash.velocity -= (deceleration / (ctx.maxSpeed || 250)) * cfg.impactSquash;
    }
    stepSpring(this.squash, speedNorm * cfg.stretchPerSpeed, cfg.squashStiffness, cfg.squashDamping, dt);
    this.lastSpeed = speed;

    // --- Lean into the direction of travel -------------------------------
    const targetTilt = Math.max(-1, Math.min(1, entity.vx / (ctx.maxSpeed || 250))) * cfg.maxTilt;
    stepSpring(this.tilt, targetTilt, cfg.tiltStiffness, cfg.tiltDamping, dt);

    // Face the way we're moving, ignoring tiny drift so a near-stationary
    // character doesn't flicker back and forth.
    if (Math.abs(entity.vx) > 12) this.facingX = entity.vx > 0 ? 1 : -1;

    // --- Idle bob ---------------------------------------------------------
    // Slower bob when moving fast (the run animation takes over visually).
    this.bobPhase += dt * cfg.bobSpeed * (1 - speedNorm * 0.4);
    this.bob = Math.sin(this.bobPhase) * cfg.bobAmount;

    // --- Blink ------------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkAmount = 1;
      this.blinkTimer = cfg.blinkIntervalMin + Math.random() * (cfg.blinkIntervalMax - cfg.blinkIntervalMin);
    }
    this.blinkAmount = approach(this.blinkAmount, 0, cfg.blinkRecover, dtScale);

    this.expression = resolveExpression(ctx, speedNorm);
  }

  /** Scale factors to apply when drawing, from the squash spring.
   * Volume-preserving: stretching along X automatically thins Y, which is
   * what makes squash/stretch read as a soft body rather than a resize. */
  getScale() {
    const s = this.squash.value;
    return { x: 1 + s, y: 1 / (1 + s) };
  }
}

/**
 * Picks a face from context. Deliberately simple and priority-ordered -
 * expressions that convey danger beat ambient ones, because that's the
 * information the player most needs at a glance.
 */
export function resolveExpression(ctx, speedNorm) {
  if (ctx.dizzy) return EXPRESSION.DIZZY;
  if (ctx.onFire) return EXPRESSION.DETERMINED;
  if (ctx.inDanger) return EXPRESSION.SCARED;
  if (ctx.crowned) return EXPRESSION.HAPPY;
  if (speedNorm > 0.75) return EXPRESSION.DETERMINED;
  return EXPRESSION.NEUTRAL;
}

/**
 * Keeps one VisualState per entity id, creating them lazily and dropping
 * ones whose entity has gone. Without the cleanup this would leak an
 * object per hazard spawned over a long session.
 */
export class VisualStateStore {
  constructor() {
    this.states = new Map();
  }

  get(id) {
    let s = this.states.get(id);
    if (!s) {
      s = new VisualState();
      this.states.set(id, s);
    }
    return s;
  }

  /** @param {Set<string>} liveIds ids still present this frame */
  prune(liveIds) {
    for (const id of this.states.keys()) {
      if (!liveIds.has(id)) this.states.delete(id);
    }
  }

  clear() {
    this.states.clear();
  }
}
