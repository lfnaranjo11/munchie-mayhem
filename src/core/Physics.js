/**
 * Physics.js - all the collision math shared by every minigame.
 *
 * WHY HAND-ROLLED PHYSICS INSTEAD OF A LIBRARY (Matter.js / Box2D / etc.):
 * Everything on screen is a circle (players, hazards, fruit) or a static
 * shape you bounce off (obstacles, walls). There are no joints, no torque,
 * no complex constraint solving - the entire need is "two circles overlap,
 * separate them and reflect their velocity". That's ~30 lines of algebra.
 * A full rigid-body engine would add a real dependency and a black box in
 * exchange for solving problems this game doesn't have - and the whole
 * point of this game is that the bounce/drag feel IS the gameplay, so it
 * needs to stay simple enough to tune by hand (see the `cfg` objects each
 * function below takes - every constant that shapes "how bouncy" or "how
 * draggy" something feels is a plain number in a config file, not buried
 * inside a physics engine's internals).
 *
 * Everything here is a pure function: given some entities, it mutates
 * their position/velocity and returns whether a collision happened. No
 * function in this file touches the DOM, canvas, or randomness.
 */

/** Returns a unit vector pointing from (0,0) toward (x,y). Falls back to
 * (1,0) for the zero vector so callers never divide by zero. */
export function normalize(x, y) {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

/**
 * Resolves a collision between two dynamic circles (player vs player, or
 * any two entities that should bounce off each other symmetrically).
 *
 * This is a standard two-step "impulse-based" resolution:
 *
 *  1. POSITIONAL CORRECTION - if the circles overlap, push them apart
 *     along the line connecting their centers (the "collision normal"),
 *     split proportionally by mass so a heavy entity barely moves and a
 *     light one gets shoved. This alone would stop things clipping
 *     through each other, but does nothing to their velocity.
 *
 *  2. VELOCITY RESOLUTION - compute the relative velocity along the
 *     normal. If they're already moving apart, there's nothing to do.
 *     Otherwise, apply an equal-and-opposite impulse `j` along the normal
 *     so that, factoring in `restitution` (the coefficient of
 *     restitution: 1 = perfectly elastic/bouncy, 0 = perfectly
 *     inelastic/no bounce, values in between are the norm for "fun"
 *     bounce), the post-collision separating speed is
 *     `restitution * (pre-collision closing speed)`.
 *
 *     The impulse formula `j = -(1 + restitution) * velAlongNormal / (1/mA + 1/mB)`
 *     falls straight out of conservation of momentum plus the
 *     restitution definition above - it's the textbook 2D elastic/
 *     inelastic collision formula, just written in terms of inverse mass
 *     so that a "mass: Infinity" entity (not used yet, but available)
 *     would correctly not move at all.
 *
 * @param {{x:number,y:number,vx:number,vy:number,radius:number,mass:number}} a
 * @param {{x:number,y:number,vx:number,vy:number,radius:number,mass:number}} b
 * @param {number} restitution 0 (dead stop) .. 1 (perfectly bouncy) .. >1 (exaggerated, still fine)
 * @returns {boolean} true if a and b were overlapping and got resolved
 */
export function resolveElasticCollision(a, b, restitution = 0.7) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius;
  if (distance >= minDist) return false;

  // Circles exactly on top of each other have no well-defined normal;
  // nudge distance so normalize() below doesn't produce NaN.
  if (distance === 0) distance = 0.01;

  const nx = dx / distance;
  const ny = dy / distance;

  // --- Step 1: positional correction ---
  const overlap = minDist - distance;
  const totalMass = a.mass + b.mass;
  a.x -= nx * overlap * (b.mass / totalMass);
  a.y -= ny * overlap * (b.mass / totalMass);
  b.x += nx * overlap * (a.mass / totalMass);
  b.y += ny * overlap * (a.mass / totalMass);

  // --- Step 2: velocity resolution ---
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  // Already separating (e.g. we just corrected an overlap but they were
  // moving apart anyway) - nothing more to do.
  if (velAlongNormal > 0) return true;

  const j = (-(1 + restitution) * velAlongNormal) / (1 / a.mass + 1 / b.mass);
  const ix = j * nx;
  const iy = j * ny;
  a.vx -= ix / a.mass;
  a.vy -= iy / a.mass;
  b.vx += ix / b.mass;
  b.vy += iy / b.mass;
  return true;
}

/**
 * Pushes a dynamic player out of a STATIC circular obstacle (a milk carton,
 * a big pepper, a chocolate barrier) and reflects the velocity component
 * that's driving it into the obstacle. Unlike resolveElasticCollision this
 * is one-sided - the obstacle never moves - which is the right model for
 * "furniture" you bounce off rather than two players colliding.
 *
 * `restitution` here plays the same role as above; pass a high value
 * (e.g. the chocolate's ~0.9) for a launchy bounce and a low value
 * (e.g. the milk's ~0.2) for something that just blocks you.
 */
export function resolveObstacleCollision(player, obstacle, restitution = 0.5) {
  const dx = player.x - obstacle.x;
  const dy = player.y - obstacle.y;
  const dist = Math.hypot(dx, dy) || 0.01;
  const minDist = player.radius + obstacle.radius;
  if (dist >= minDist) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  player.x += nx * overlap;
  player.y += ny * overlap;

  // Only reflect the part of the velocity pointing INTO the obstacle
  // (velocity along the normal, negative = approaching). A player sliding
  // past the obstacle's edge shouldn't get slowed down at all.
  const velAlongNormal = player.vx * nx + player.vy * ny;
  if (velAlongNormal < 0) {
    player.vx -= (1 + restitution) * velAlongNormal * nx;
    player.vy -= (1 + restitution) * velAlongNormal * ny;
  }
  return true;
}

/**
 * Applies a MOVING hazard's influence on a player it's touching, blended
 * between "bounce" and "drag" depending on the angle of impact - this is
 * the core feel of Organic Disposal's drifting food and Ketchin' Up's
 * flying chocolate.
 *
 * The blend is controlled by `alignment`: the dot product of the hazard's
 * direction of travel with the collision normal (the line from hazard
 * center to player center).
 *   alignment ~  1  -> hazard is moving straight INTO the player (head-on)
 *                       -> mostly BOUNCE (reflect the player away)
 *   alignment ~  0  -> hazard is moving roughly TANGENT to the player
 *                       (grazing past sideways) -> mostly DRAG (sweep the
 *                       player along with the hazard's own velocity)
 *   alignment ~ -1  -> hazard is moving away from the player (can happen
 *                       right after a bounce) -> tiny bounce contribution
 *                       only, so it doesn't fight the separation
 *
 * `cfg` (see each minigame's config.js, `hazardInfluence` block):
 *   bounceStrength      how hard a head-on hit shoves the player away
 *   dragStrength        how much of the hazard's own velocity "sticks" to
 *                        the player on a glancing hit
 *   staticBounceStrength fallback push for a hazard with ~zero velocity
 *                        (e.g. it just spawned) so contact never no-ops
 */
export function applyHazardInfluence(player, hazard, cfg) {
  const dx = player.x - hazard.x;
  const dy = player.y - hazard.y;
  const distance = Math.hypot(dx, dy) || 0.01;
  const minDist = player.radius + hazard.radius;
  if (distance >= minDist) return false;

  const [nx, ny] = normalize(dx, dy);
  const overlap = minDist - distance;
  player.x += nx * overlap;
  player.y += ny * overlap;

  const hazardSpeed = Math.hypot(hazard.vx, hazard.vy);
  if (hazardSpeed > 0.001) {
    const [hx, hy] = normalize(hazard.vx, hazard.vy);
    const alignment = hx * nx + hy * ny;
    const bounceAmount = Math.max(alignment, 0);
    const dragAmount = 1 - Math.abs(alignment);

    // Bounce component: push the player directly away from the hazard.
    player.vx += nx * hazardSpeed * bounceAmount * cfg.bounceStrength;
    player.vy += ny * hazardSpeed * bounceAmount * cfg.bounceStrength;
    // Drag component: sweep the player along the hazard's own heading.
    player.vx += hazard.vx * dragAmount * cfg.dragStrength;
    player.vy += hazard.vy * dragAmount * cfg.dragStrength;
  } else {
    player.vx += nx * cfg.staticBounceStrength;
    player.vy += ny * cfg.staticBounceStrength;
  }
  return true;
}

/**
 * Shortest distance from point (px,py) to the line SEGMENT (not infinite
 * line) from (x1,y1) to (x2,y2). Used by Ketchin' Up to test "is a player
 * touching the laser beam", since the beam is a segment from the emitter
 * to wherever it's currently blocked (or its max range).
 *
 * Standard technique: project the point onto the infinite line to find
 * how far along the segment the closest point would be (`t`), clamp that
 * to [0, 1] so the closest point can't fall beyond either endpoint, then
 * measure the distance to that clamped point.
 */
export function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}
