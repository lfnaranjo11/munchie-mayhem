/**
 * sharedSteps.js - the handful of per-frame steps almost every minigame
 * needs (move players, bounce them off each other, bounce them off static
 * obstacles). Keeping these here instead of copy-pasted into every
 * minigame means the "skating" feel and the bounce rules only ever need
 * tuning in one place (PlayerController.js / Physics.js).
 */
import { applyMomentumMovement } from '../core/PlayerController.js';
import { resolveElasticCollision, resolveObstacleCollision as resolveObstacle } from '../core/Physics.js';

/**
 * Moves every alive player by one physics step and clamps them inside the
 * arena. `movementCfgOrFn` can be a single config object (most minigames)
 * or a `(player) => config` function for minigames where different
 * players move differently right now (e.g. Pepper to Die's juggernaut is
 * faster than everyone else).
 *
 * `opts.clampLeft/Right/Top/Bottom` (all default true) let a minigame
 * leave one edge un-clamped when crossing it should be dangerous rather
 * than blocked - Organic Disposal sets clampLeft:false so players can
 * actually walk into the saw zone and be eliminated by it, instead of
 * bouncing off an invisible wall in front of it.
 */
export function stepPlayersMovement(players, inputs, arena, dt, movementCfgOrFn, opts = {}) {
  const { clampLeft = true, clampRight = true, clampTop = true, clampBottom = true } = opts;
  for (const p of players) {
    if (!p.alive) continue;
    const cfg = typeof movementCfgOrFn === 'function' ? movementCfgOrFn(p) : movementCfgOrFn;
    const input = inputs[p.id] ?? { x: 0, y: 0 };
    applyMomentumMovement(p, input, dt, cfg);
    if (clampLeft) p.x = Math.max(p.radius, p.x);
    if (clampRight) p.x = Math.min(arena.width - p.radius, p.x);
    if (clampTop) p.y = Math.max(p.radius, p.y);
    if (clampBottom) p.y = Math.min(arena.height - p.radius, p.y);
  }
}

/** Resolves bounces between every pair of currently-alive players. O(n^2)
 * but n is a handful of players, so this is nowhere near a bottleneck. */
export function stepPlayerCollisions(players, restitution) {
  const alive = players.filter((p) => p.alive);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      resolveElasticCollision(alive[i], alive[j], restitution);
    }
  }
}

/** Re-exported so minigames only need to import from this one module for
 * the common per-frame steps. */
export const resolveObstacleCollision = resolveObstacle;
