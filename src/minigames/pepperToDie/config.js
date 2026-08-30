import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  maxDuration: 100,
  playerRestitution: 0.7,
  movement: { acceleration: 950, maxSpeed: 240, friction: 0.92, softClamp: 0.55 },

  chocoCount: 4,
  chocoRadius: 34,
  chocoRestitution: 0.95, // bouncy barrier
  milkCount: 4,
  milkRadius: 30,
  milkRestitution: 0.2, // mostly just blocks

  pepperRadius: 18,
  pepperRespawnDelay: 1.5,
  // How long an unclaimed pepper waits before it starts hunting a player
  // down, so the round can't stall with everyone avoiding it forever.
  pepperIdleTimeout: 4,
  pepperHuntSpeed: 150,

  juggernautDuration: 6,
  juggernautSpeedMultiplier: 1.35,
  timerRefreshOnKill: 2,
};

export function buildPepperToDieConfig(globalConfig) {
  return buildMinigameConfig('pepperToDie', defaultConfig, globalConfig);
}
