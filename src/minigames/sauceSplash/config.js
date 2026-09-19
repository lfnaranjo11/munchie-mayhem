import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  // Score-based rounds want a firm clock: long enough for a comeback,
  // short enough that the last stretch still feels urgent.
  maxDuration: 70,
  backgroundColor: '#fff4e0',
  playerRestitution: 0.7,
  movement: { acceleration: 980, maxSpeed: 265, friction: 0.93, softClamp: 0.55 },

  // Board resolution. Higher = finer painting, but also a bigger network
  // snapshot (one character per cell). 44 columns lands around 1 KB
  // before compression, which deflates to well under 200 bytes because
  // painted ground is long runs of the same value.
  gridCols: 44,
  brushRadius: 30,

  // Ends early if anyone runs away with it, so a decided round doesn't
  // drag on with everyone just watching the clock.
  dominanceThreshold: 0.62,

  obstacleCount: 5,
  obstacleRadius: 30,
  obstacleRestitution: 0.5,

  jar: {
    firstDelay: 4,
    minInterval: 5,
    maxInterval: 9,
    maxActive: 2,
    radius: 15,
    lifetime: 12,
    candidates: 18, // sampled spawn points; the most open one wins
    boostDuration: 5,
    brushMultiplier: 2.1,
    speedMultiplier: 1.25,
  },

  botJarInterest: 260, // a bot will detour this far for a jar
  botSamples: 14, // candidate points sampled when looking for fresh ground
};

export function buildSauceSplashConfig(globalConfig) {
  return buildMinigameConfig('sauceSplash', defaultConfig, globalConfig);
}
