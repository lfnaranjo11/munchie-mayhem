/**
 * deviceProfile.js - decides how the game should adapt to the device it's
 * running on: touch controls or keyboard, how many local players fit, and
 * how much screen there is to work with.
 *
 * WHY THIS IS A PURE FUNCTION:
 * `resolveDeviceProfile()` takes an explicit environment object rather
 * than reading `window`/`navigator` itself. That means:
 *   - it's unit-testable in plain Node with no DOM (see test/smoke.mjs),
 *     so the "phones get 1 player, desktops get 2" rule is actually
 *     verified rather than assumed
 *   - a variant deployment or a debug URL param can force a profile
 *     without lying to the browser
 * `detectEnvironment()` is the thin, untestable-by-nature wrapper that
 * actually reads the browser; keep it as dumb as possible.
 */

/**
 * @typedef {object} DeviceEnv
 * @property {number} width          viewport width in CSS px
 * @property {number} height         viewport height in CSS px
 * @property {boolean} hasTouch      device reports touch support
 * @property {boolean} hasFinePointer device has a precise pointer (mouse/trackpad)
 */

/**
 * @typedef {object} DeviceProfile
 * @property {boolean} isTouch          use on-screen controls
 * @property {boolean} isCompact        small screen - tighter UI, hide non-essential chrome
 * @property {boolean} isPortrait       taller than wide
 * @property {number}  maxLocalPlayers  how many humans can share this device
 * @property {boolean} showNameLabels   labels get illegible on small canvases
 */

/** Below this CSS width we treat the screen as a phone-sized layout. */
export const COMPACT_WIDTH_BREAKPOINT = 820;

/**
 * @param {DeviceEnv} env
 * @returns {DeviceProfile}
 */
export function resolveDeviceProfile(env) {
  const isCompact = env.width < COMPACT_WIDTH_BREAKPOINT;

  // Touch controls are used when the device supports touch AND either has
  // no precise pointer at all, or is small enough that a shared keyboard
  // isn't realistic. A large touchscreen laptop (touch + fine pointer +
  // wide) therefore still gets the keyboard path, which is what someone
  // on that hardware actually expects.
  const isTouch = env.hasTouch && (!env.hasFinePointer || isCompact);

  // The hard rule from the brief: a phone is one person's device, so it's
  // 1 human + bots. Two people can't share a phone-sized virtual
  // joystick, and pretending otherwise would make the game unplayable.
  const maxLocalPlayers = isTouch && isCompact ? 1 : 2;

  return {
    isTouch,
    isCompact,
    isPortrait: env.height > env.width,
    maxLocalPlayers,
    showNameLabels: !isCompact,
  };
}

/** Reads the real browser environment. Only call this from browser code. */
export function detectEnvironment() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    // `pointer: fine` = mouse/trackpad/stylus; `coarse` = finger.
    hasFinePointer: window.matchMedia?.('(pointer: fine)').matches ?? false,
  };
}

/**
 * `?forceInput=touch` / `?forceInput=keyboard` overrides detection, so you
 * can test the mobile control scheme on a desktop browser (and vice versa)
 * without emulating a device.
 */
export function applyInputOverride(profile, override) {
  if (override === 'touch') return { ...profile, isTouch: true, maxLocalPlayers: 1 };
  if (override === 'keyboard') return { ...profile, isTouch: false };
  return profile;
}

export function getInputOverrideFromURL() {
  return new URLSearchParams(window.location.search).get('forceInput');
}
