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
  /**
   * @param {import('../core/RNG.js').RNG} rng seeded, so bot behaviour is reproducible
   * @param {{reactionDelay?: number}} [cfg] reactionDelay is how long (seconds)
   *   a bot commits to a decision before re-evaluating.
   */
  constructor(rng, cfg = {}) {
    this.rng = rng;
    this.wanderTargets = new Map();
    // WHY BOTS PAUSE BEFORE RE-AIMING:
    // Re-deciding every tick makes a bot frame-perfect - it re-aims at a
    // moving target 60 times a second, which no human can match. That's
    // how bots came to win nearly every King of the Meal scramble. A
    // short commitment window costs them that inhuman precision without
    // making them look stupid.
    this.reactionDelay = cfg.reactionDelay ?? 0.22;
    this.clock = 0;
    this.decisions = new Map();
  }

  /** Called once per simulation step so bot timing is tied to the fixed
   * timestep rather than to how often decide() happens to be called. */
  advance(dt) {
    this.clock += dt;
  }

  decide(player, minigame) {
    if (!minigame) return { x: 0, y: 0 };

    const cached = this.decisions.get(player.id);
    if (cached && this.clock - cached.at < cached.delay) {
      // Re-resolve the remembered intent against current positions: the
      // bot keeps pursuing the same TARGET, it just doesn't reconsider
      // whether that's still the best target.
      return this.toInput(player, cached.intent);
    }

    const intent = minigame.getBotIntent?.(player) ?? this.wander(player, minigame.arena);
    this.decisions.set(player.id, {
      intent,
      at: this.clock,
      // Jitter the delay so four bots don't move in lockstep.
      delay: this.reactionDelay * this.rng.range(0.6, 1.4),
    });
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
