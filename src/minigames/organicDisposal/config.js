import { buildMinigameConfig } from '../configUtils.js';

export const defaultConfig = {
  maxDuration: 75,
  playerRestitution: 0.75,
  sawZoneWidth: 70,
  // Constant leftward push (px/s^2) so standing still is never fully safe.
  currentForce: 18,
  grindEffectLife: 0.35,
  movement: { acceleration: 1000, maxSpeed: 260, friction: 0.93, softClamp: 0.5 },
  spawn: { minInterval: 0.9, maxInterval: 1.8 },
  botDangerRadius: 130,
  botSafeMargin: 40,
  hazardInfluence: { bounceStrength: 0.9, dragStrength: 0.5, staticBounceStrength: 60 },
  hazardTypes: [
    { id: 'sushi', radius: 26, mass: 1.4, color: '#7fbf6a', minSpeed: 90, maxSpeed: 150, spreadAngle: 0.35 },
    { id: 'sausage', radius: 22, mass: 1.1, color: '#d97b52', minSpeed: 110, maxSpeed: 190, spreadAngle: 0.5 },
    { id: 'pudding', radius: 30, mass: 1.6, color: '#e8b4d8', minSpeed: 70, maxSpeed: 120, spreadAngle: 0.25 },
    { id: 'tomato', radius: 20, mass: 1.0, color: '#e0523a', minSpeed: 130, maxSpeed: 210, spreadAngle: 0.6 },
  ],
};

export function buildOrganicDisposalConfig(globalConfig) {
  return buildMinigameConfig('organicDisposal', defaultConfig, globalConfig);
}
