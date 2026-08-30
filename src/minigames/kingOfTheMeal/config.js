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
  fumbleForce: 90,
  crownFriction: 0.9,
};

export function buildKingOfTheMealConfig(globalConfig) {
  return buildMinigameConfig('kingOfTheMeal', defaultConfig, globalConfig);
}
