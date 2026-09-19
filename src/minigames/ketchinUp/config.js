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

  /**
   * The charge -> fire -> cool cycle. These are the numbers that decide
   * whether the round feels tense or exhausting.
   *
   * Roughly 60% of each cycle is safe (cool + charge), which is the
   * opposite of the original design where the beam was live most of the
   * time. If it starts feeling too easy, shorten `coolTime` before
   * touching rotation speed - taking away the rest beats bites much
   * harder than spinning faster.
   */
  beam: {
    openingCalm: 2.2, // grace period at the very start of the round
    chargeTime: 1.0, // visible, harmless telegraph
    fireTime: 1.15, // lethal
    coolTime: 1.9, // beam completely off
  },

  /**
   * Rotation. The base speed is deliberately slow: you should be able to
   * see where the beam is heading and outrun it. `rampPerCycle` is the
   * escalation, capped by `maxSpeed` so late rounds never return to the
   * old spin-too-fast-to-read behaviour.
   */
  rotation: {
    baseSpeed: 0.3, // rad/s while firing (~17 deg/s)
    chargeFactor: 0.55, // slower still during the telegraph, so the aim reads clearly
    coolFactor: 1.8, // faster while safe, to re-aim between shots
    rampPerCycle: 0.045,
    maxSpeed: 0.85,
  },

  /**
   * The repositioning dash. Beam stays OFF for the whole move, making it
   * the one genuinely safe beat in the round. Big and fast on purpose -
   * a cannon that only nudged itself made the arena feel static.
   */
  reposition: {
    everyCycles: 3, // dash after this many fire cycles
    travelSpeed: 430, // px/s - fast enough to feel like a charge across the board
    candidates: 10, // sampled destinations; the furthest one wins
    spinSpeed: 1.1, // lazy spin while travelling
    settleTime: 0.8, // stillness on arrival before charging again
  },

  orbitAngularVelocity: 0.32, // used by the 'orbit' variation
};

export function buildKetchinUpConfig(globalConfig) {
  return buildMinigameConfig('ketchinUp', defaultConfig, globalConfig);
}
