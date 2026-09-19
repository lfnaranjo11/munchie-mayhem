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

  // ── Loose crown: UFO flight, then landing ──────────────────────────
  // The crown is UNTOUCHABLE while hovering and only grabbable once it
  // has landed. See KingOfTheMeal.ejectCrown for the reasoning.
  hoverSpeed: 420, // px/s in transit - fast, deliberately uncatchable
  hoverMinDuration: 0.8, // floor, so short throws still read as a flight
  hoverAltitude: 46, // peak visual height (renderer only)
  hoverWobble: 26, // sideways sway in flight, for the UFO feel

  landCandidates: 24, // sampled landing spots; best-scoring one wins
  landMinDistance: 0.45, // min throw distance, as a fraction of the arena's
  // shorter side - far enough that losing the crown means really losing it
};

export function buildKingOfTheMealConfig(globalConfig) {
  return buildMinigameConfig('kingOfTheMeal', defaultConfig, globalConfig);
}
