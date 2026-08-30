import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  maxDuration: 90,
  playerRestitution: 0.7,
  movement: { acceleration: 1000, maxSpeed: 250, friction: 0.93, softClamp: 0.5 },

  obstacleCount: 7,
  obstacleRadius: 30,
  obstacleMass: 1.5,
  obstacleLaunchSpeed: 260,
  flyingObstacleInfluence: { bounceStrength: 1, dragStrength: 0.4, staticBounceStrength: 40 },

  beamLength: 1400,
  beamWidth: 12,
  baseAngularVelocity: 0.6,
  secondaryAngularFactor: 0.7,
  translateSpeed: 70,
  orbitAngularVelocity: 0.4,

  // Duty-cycle pulsing: "not so fast and kinda intermittent so people can
  // escape, then faster and less intermittent." baseActiveFraction is how
  // "on" the beam is right at speedMultiplier=1; activeFractionGrowth
  // pushes it toward fully-on (1.0) as speedMultiplier climbs.
  pulse: { baseActiveFraction: 0.4, activeFractionGrowth: 0.18, period: 1.3 },

  phaseDuration: { min: 5, max: 9 },
  speedRampPerPhase: 0.25,
  maxSpeedMultiplier: 2.2,
};

export function buildKetchinUpConfig(globalConfig) {
  return buildMinigameConfig('ketchinUp', defaultConfig, globalConfig);
}
