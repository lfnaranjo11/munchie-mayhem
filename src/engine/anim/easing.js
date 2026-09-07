/**
 * easing.js - easing curves and a critically-damped spring.
 *
 * Animation "feel" is almost entirely about how a value travels from A to
 * B, not the endpoints. Linear motion reads as robotic; an overshoot-and-
 * settle reads as alive. These are the curves the rest of the animation
 * layer is built from.
 *
 * All pure functions of t in [0,1] returning a (usually) [0,1] value -
 * unit-tested in test/smoke.mjs.
 */

export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t) => t * t;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Overshoots past 1 then settles - the classic "pop" for spawns and pickups. */
export function easeOutBack(t, overshoot = 1.70158) {
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

/** Decaying oscillation - good for impacts and "boing" reactions. */
export function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  const period = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * period) + 1;
}

/** A single quick bounce then settle. */
export function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/**
 * Frame-rate-independent exponential approach: moves `current` a fraction
 * of the way to `target` each step. Used for anything that should smoothly
 * chase a value without a fixed duration (camera zoom, colour blends).
 *
 * Same `pow(rate, dt*60)` trick as PlayerController's friction, so the
 * result is identical at 60Hz and 144Hz.
 */
export function approach(current, target, rate, dtScale) {
  const t = 1 - Math.pow(1 - rate, dtScale);
  return current + (target - current) * t;
}

/**
 * A damped spring, integrated one step. Unlike the eased curves above
 * (which need a known start, end, and duration), a spring can be
 * retargeted at any moment and stays continuous - ideal for values that
 * get knocked around unpredictably, like a character's squash reacting to
 * collisions that could happen any frame.
 *
 * @param {{value:number, velocity:number}} state mutated in place
 * @param {number} target resting value
 * @param {number} stiffness how hard it's pulled toward target
 * @param {number} damping   how quickly oscillation dies (higher = less springy)
 * @param {number} dt        seconds
 */
export function stepSpring(state, target, stiffness, damping, dt) {
  const force = (target - state.value) * stiffness;
  state.velocity += force * dt;
  state.velocity *= Math.pow(damping, dt * 60);
  state.value += state.velocity * dt;
  return state.value;
}
