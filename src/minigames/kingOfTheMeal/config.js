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
  ejectDistanceMin: 0.55,
  ejectDistanceMax: 0.90,
};

export function buildKingOfTheMealConfig(globalConfig) {
  return buildMinigameConfig('kingOfTheMeal', defaultConfig, globalConfig);
}
