/**
 * global.config.js - the baseline every minigame and config variant
 * builds on top of (see src/minigames/configUtils.js for the precedence
 * order, and config/variants/*.json for how a deployment overrides this).
 */
export const GLOBAL_DEFAULTS = {
  // Logical arena units, NOT canvas pixels. This is the REFERENCE arena:
  // its total area is preserved, but its aspect ratio is adapted to the
  // device's screen at round start so the canvas fills the viewport
  // instead of letterboxing. See src/core/arenaFit.js.
  arena: {
    width: 960,
    height: 540,

    // How extreme the arena's shape is allowed to get. An unclamped
    // portrait phone (~0.45 aspect) would make a sliver arena that plays
    // badly. 0.52 ≈ a tall phone portrait, 2.2 ≈ ultrawide.
    //
    // Tuning note: RAISING minAspect makes the arena squarer, which plays
    // better (especially Organic Disposal, whose hazards need horizontal
    // run-up) but leaves unused bands at the top/bottom on tall phones.
    // Those bands get filled with the minigame's own background colour, so
    // they read as seamless rather than letterboxed - but they're still
    // unusable play space. 0.52 fills a typical phone almost completely;
    // move back toward 0.62 if portrait rounds start to feel cramped.
    minAspect: 0.52,
    maxAspect: 2.2,

    // ── mobileArenaScale ──────────────────────────────────────────────
    // Linear scale applied to the arena on compact (phone-sized) devices.
    // Values BELOW 1 shrink the arena, which makes players and hazards
    // appear proportionally BIGGER on a small screen - the "zoom in"
    // knob. 1 = identical play area to desktop.
    //
    // Trade-off to be aware of when tuning: a smaller arena also means
    // less room to run away, which makes chase-heavy minigames (King of
    // the Meal, Pepper to Die) meaningfully more frantic. 0.9 is a mild
    // default; drop toward 0.75 for a much more zoomed-in, hectic phone
    // build, or set 1 to keep phone and desktop balance identical.
    mobileScale: 0.9,
  },

  // The optional zoom-in-on-my-player button (touch devices). Purely a
  // view transform - see src/engine/Camera.js.
  camera: {
    zoomFactor: 1.9,
    smoothing: 0.12,
  },

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
