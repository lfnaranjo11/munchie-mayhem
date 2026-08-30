import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  maxDuration: 90,
  playerRestitution: 0.7,
  movement: { acceleration: 900, maxSpeed: 260, friction: 0.93, softClamp: 0.6 },

  spawn: { minInterval: 1.4, maxInterval: 2.6 },
  maxBombsBase: 1,
  maxBombsCap: 5,
  markDuration: 0.7, // telegraph time before a bomb arms in place
  fuseTime: 1.8, // time to run once armed
  blastRadius: 70,
  craterLethalFactor: 0.7, // fraction of crater radius that's actually lethal

  botMarkAwareRadius: 140,
  botCraterAwareFactor: 1.4,
};

export function buildExplodingFruitsConfig(globalConfig) {
  return buildMinigameConfig('explodingFruits', defaultConfig, globalConfig);
}
