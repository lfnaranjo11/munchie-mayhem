/**
 * BotBrain.js - AI for bot-controlled players.
 *
 * Design: reactive steering behaviours (seek / flee / wander), not
 * pathfinding or lookahead. Each minigame optionally implements
 * `getBotIntent(player)` returning one of:
 *   { seek: {x,y} }   - move toward a point (or any object with x/y, so a
 *                        player, hazard, or pickup all work directly)
 *   { flee: {x,y} }   - move away from a point
 *   { dir:  {x,y} }   - move in an exact raw direction
 *   null              - "no opinion, just wander" (falls back to wander())
 *
 * This keeps minigame-specific AI logic living IN the minigame file next
 * to the rules it's reacting to (e.g. ExplodingFruits.getBotIntent flees
 * live bombs) while BotBrain only handles turning an "intent" into the
 * same {x,y} direction shape InputManager produces for humans - so from
 * TournamentManager's point of view, a bot and a human are interchangeable
 * input sources.
 */
function normalizeDir(dir) {
  const len = Math.hypot(dir.x, dir.y);
  if (len < 1e-4) return { x: 0, y: 0 };
  return { x: dir.x / len, y: dir.y / len };
}

export class BotBrain {
  /** @param {import('../core/RNG.js').RNG} rng - seeded, so bot wandering is reproducible too */
  constructor(rng) {
    this.rng = rng;
    this.wanderTargets = new Map();
  }

  decide(player, minigame) {
    if (!minigame) return { x: 0, y: 0 };
    const intent = minigame.getBotIntent?.(player) ?? this.wander(player, minigame.arena);
    return this.toInput(player, intent);
  }

  /** Ambles toward a random point, picking a new one once close to the last. */
  wander(player, arena) {
    let target = this.wanderTargets.get(player.id);
    if (!target || Math.hypot(target.x - player.x, target.y - player.y) < 30) {
      target = {
        x: this.rng.range(arena.width * 0.15, arena.width * 0.85),
        y: this.rng.range(arena.height * 0.15, arena.height * 0.85),
      };
      this.wanderTargets.set(player.id, target);
    }
    return { seek: target };
  }

  toInput(player, intent) {
    if (intent.dir) return normalizeDir(intent.dir);
    const target = intent.seek || intent.flee;
    if (!target) return { x: 0, y: 0 };
    let dx = target.x - player.x;
    let dy = target.y - player.y;
    if (intent.flee) {
      dx = -dx;
      dy = -dy;
    }
    return normalizeDir({ x: dx, y: dy });
  }
}
