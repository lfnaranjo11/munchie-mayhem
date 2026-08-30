/**
 * global.config.js - the baseline every minigame and config variant
 * builds on top of (see src/minigames/configUtils.js for the precedence
 * order, and config/variants/*.json for how a deployment overrides this).
 */
export const GLOBAL_DEFAULTS = {
  // Logical arena units, NOT canvas pixels - CanvasRenderer scales this to
  // fit whatever size the canvas actually is on screen.
  arena: { width: 960, height: 540 },

  // The shared "skating" movement baseline (see PlayerController.js).
  // Individual minigames can still override any of these in their own
  // config.js (e.g. Organic Disposal runs a bit faster).
  movementDefaults: { acceleration: 950, maxSpeed: 250, friction: 0.92, softClamp: 0.55 },

  // See ChaosDirector.js for what each of these does.
  chaos: { graceTime: 6, rampRate: 0.18, maxMultiplier: 2.6, decayOnKill: 0.35 },

  // A variant JSON (config/variants/*.json) fills this in to tweak a
  // specific minigame's config without touching any other minigame.
  perMinigameOverrides: {},
};
