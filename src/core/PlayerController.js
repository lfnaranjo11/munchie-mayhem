/**
 * PlayerController.js - the ONE function that moves any player, in any
 * minigame. This is deliberately the single place that produces the
 * "running on skates" feel the brief asked for, so it's consistent
 * everywhere and only needs tuning in one spot.
 */

/**
 * Integrates one physics step of momentum-based movement.
 *
 * This is intentionally NOT "position += input * speed" (which feels
 * instant and robotic). Instead, input applies an ACCELERATION, velocity
 * carries over frame to frame, and friction bleeds it off gradually. The
 * result: you keep sliding briefly after releasing a direction, and
 * changing direction fully takes a beat rather than snapping - the
 * "subtle but definitely there" momentum from the brief.
 *
 * @param {{x:number,y:number,vx:number,vy:number}} entity - mutated in place
 * @param {{x:number,y:number}} input - desired direction, each axis roughly
 *   in [-1, 1] (InputManager already normalizes diagonals to length 1)
 * @param {number} dt - fixed timestep in seconds
 * @param {{acceleration:number,maxSpeed:number,friction:number,softClamp:number}} cfg
 *   acceleration  px/s^2 applied while a direction is held
 *   maxSpeed      the speed input alone will settle at
 *   friction      fraction of velocity kept per 1/60s tick when coasting
 *                 (0.92 means "lose ~8% of your speed every 60th of a
 *                 second"); see the frame-rate-independent note below
 *   softClamp     0..1, how firmly maxSpeed is enforced. 1 = hard clamp,
 *                 you can never exceed maxSpeed. 0 = no clamp at all, so a
 *                 hard bounce (see Physics.js) can send you flying well
 *                 past maxSpeed before friction reels you back in - that
 *                 overshoot is exactly what makes bounces feel punchy
 *                 instead of instantly capped. Values in between blend
 *                 the two, which is what every minigame currently uses.
 */
export function applyMomentumMovement(entity, input, dt, cfg) {
  entity.vx += (input?.x ?? 0) * cfg.acceleration * dt;
  entity.vy += (input?.y ?? 0) * cfg.acceleration * dt;

  const speed = Math.hypot(entity.vx, entity.vy);
  if (speed > cfg.maxSpeed && speed > 0) {
    const clamp = cfg.softClamp ?? 0.6;
    // Blend between "leave velocity alone" (factor 1) and "scale it down
    // to exactly maxSpeed" (factor maxSpeed/speed), weighted by softClamp.
    const factor = (1 - clamp) + (cfg.maxSpeed / speed) * clamp;
    entity.vx *= factor;
    entity.vy *= factor;
  }

  // Friction is defined as "per 1/60s tick" so the tuning numbers in
  // config files stay intuitive regardless of the actual fixed timestep.
  // Raising a per-tick factor to the power of (dt * 60) converts it to
  // the equivalent decay for however many (fractional) ticks this step
  // actually covers - this is what keeps the game feeling identical
  // whether it's simulated at 60Hz, 120Hz, or anything else.
  const frictionFactor = Math.pow(cfg.friction, dt * 60);
  entity.vx *= frictionFactor;
  entity.vy *= frictionFactor;

  entity.x += entity.vx * dt;
  entity.y += entity.vy * dt;
}
