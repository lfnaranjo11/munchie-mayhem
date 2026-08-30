/**
 * Entity.js - factory functions for the plain-object entities every
 * minigame works with. Deliberately plain data (no classes, no methods) so
 * that:
 *   - Physics.js functions can treat players and hazards identically
 *     (anything with x/y/vx/vy/radius/mass works)
 *   - a future networked build can serialize/diff this trivially
 *   - the renderer never needs to know about game-logic behaviour, only
 *     these fields
 */
let idCounter = 0;

/**
 * @param {object} opts
 * @returns a player entity. `score` persists across rounds (tournament
 *   points); `roundState` is a scratch object each minigame resets and
 *   uses for its own per-round bookkeeping (e.g. a juggernaut timer).
 */
export function createPlayer({ x = 0, y = 0, radius = 22, mass = 1, color = '#f4c150', name = 'Player' } = {}) {
  return {
    id: `player_${idCounter++}`,
    kind: 'player',
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    mass,
    color,
    name,
    alive: true,
    isBot: false,
    inputSlot: null,
    score: 0,
    roundState: {},
  };
}

/** A generic moving hazard (drifting food, a launched chocolate block, ...). */
export function createHazard({ x = 0, y = 0, radius = 20, mass = 1, color = '#e0523a', vx = 0, vy = 0, skin = null } = {}) {
  return { id: `hazard_${idCounter++}`, kind: 'hazard', x, y, vx, vy, radius, mass, color, skin, alive: true };
}
