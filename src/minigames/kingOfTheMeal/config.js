import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  maxDuration: 120,
  playerRestitution: 0.7,
  arenaScale: 1.1, // "a little bigger (like 10%) and fuller of things"
  movement: { acceleration: 980, maxSpeed: 255, friction: 0.92, softClamp: 0.55 },

  bigObstacleCount: 4,
  bigObstacleRadius: 38,
  smallObstacleCount: 6,
  smallObstacleRadius: 20,
  obstacleRestitution: 0.4,

  transferCooldown: 0.6,
  targetHeldTime: 20,
  fumbleChancePerSecond: 0.01,

  // How far the crown is thrown when it pops off, as a fraction of the
  // arena's SMALLER dimension (so it behaves sanely on a tall phone arena
  // as well as a wide desktop one). Defaults to roughly 1/4 - 1/3 of the
  // map: far enough that the ex-holder can't just turn around and grab it
  // back, close enough that it stays a real scramble rather than a long
  // walk. Multiplied by chaos intensity on a fumble, so the throw gets
  // longer as the round heats up.
  ejectDistanceMin: 0.25,
  ejectDistanceMax: 0.33,

  // ── Loose-crown drift (see KingOfTheMeal.updateDroppedCrown) ────────
  // The crown floats like a feather rather than sitting still: slow
  // travel with a sideways sway, punctuated by sudden veers so players
  // can't just run a straight intercept.
  driftSpeed: 55, // px/s, multiplied by chaos intensity
  driftChangeMin: 0.7, // seconds between sudden direction changes
  driftChangeMax: 1.8,
  driftTurnMin: 0.8, // radians per veer (~45deg)
  driftTurnMax: 2.2, // (~126deg) - big enough to feel abrupt
  driftSwaySpeed: 3.2, // how fast the sideways sway oscillates
  driftSwayAmount: 0.55, // how wide the sway is, relative to heading
};

export function buildKingOfTheMealConfig(globalConfig) {
  return buildMinigameConfig('kingOfTheMeal', defaultConfig, globalConfig);
}
