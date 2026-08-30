/**
 * ChaosDirector.js - the "if everyone's winning and nobody's dying, ramp
 * the speed like crazy" system, made generic so every minigame can use it
 * the same way instead of re-implementing its own stall detector.
 *
 * Each minigame owns one ChaosDirector instance for its round and feeds it
 * one boolean per physics step: "did an elimination happen just now?".
 * MinigameBase.step() does this automatically by diffing the alive-player
 * count before/after each update, so individual minigames don't have to
 * remember to call it - see MinigameBase.js.
 *
 * The output, `intensity`, is a multiplier that starts at 1 (normal) and
 * climbs toward `maxMultiplier` the longer the round goes without a kill.
 * Each minigame decides for itself what to multiply by it - hazard spawn
 * rate, projectile speed, beam rotation speed, crown-fumble chance,
 * whatever fits that minigame's "increase the danger" knob.
 */
export class ChaosDirector {
  /**
   * @param {{graceTime:number, rampRate:number, maxMultiplier:number, decayOnKill:number}} cfg
   *   graceTime     seconds with no elimination before intensity starts rising
   *   rampRate      intensity gained per second once past graceTime
   *   maxMultiplier ceiling on intensity
   *   decayOnKill   how much intensity drops (not necessarily to zero) when
   *                 someone IS eliminated - 1 means a full reset to
   *                 baseline, smaller values let some accumulated tension
   *                 persist across a single kill instead of feeling like a
   *                 hard reset
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.timeSinceElimination = 0;
    this.intensity = 1;
  }

  /**
   * @param {number} dt fixed timestep in seconds
   * @param {boolean} eliminationHappened did a player get eliminated this step?
   * @returns {number} the current intensity multiplier
   */
  update(dt, eliminationHappened) {
    if (eliminationHappened) {
      this.timeSinceElimination = 0;
      this.intensity = Math.max(1, this.intensity - this.cfg.decayOnKill);
    } else {
      this.timeSinceElimination += dt;
      if (this.timeSinceElimination >= this.cfg.graceTime) {
        this.intensity = Math.min(this.cfg.maxMultiplier, this.intensity + this.cfg.rampRate * dt);
      }
    }
    return this.intensity;
  }
}
