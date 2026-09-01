/**
 * arenaFit.js - decides the arena's logical dimensions for the device
 * currently playing.
 *
 * THE PROBLEM THIS SOLVES:
 * The arena used to be a hardcoded 960x540 (16:9). A phone in portrait is
 * roughly 9:19.5, so fitting a 16:9 canvas into it by width left a short
 * letterboxed band floating in a tall empty page - the "screen within a
 * screen" effect. Scaling it up to fill the height instead would have
 * overflowed horizontally. Neither works, because the mismatch is the
 * *aspect ratio*, not the size.
 *
 * THE FIX - adapt the arena's SHAPE to the device, hold its AREA constant:
 * A portrait phone gets a tall arena, a landscape phone a wide one, a
 * desktop the usual 16:9-ish one. Because total play area stays constant
 * (see below), nobody gets meaningfully more or less room to run than
 * anyone else - which matters since a config variant might be deployed to
 * a mix of devices and the tuning should still hold. This works precisely
 * because every minigame already receives `arena` as a parameter and lays
 * itself out relative to `arena.width`/`arena.height` rather than assuming
 * fixed numbers.
 *
 * Pure function, no DOM - unit-tested in test/smoke.mjs.
 */

/**
 * @param {{width:number,height:number}} baseArena the reference arena from global config
 * @param {number} viewportAspect width / height of the space available on screen
 * @param {{minAspect:number, maxAspect:number, scale?:number}} opts
 *   minAspect/maxAspect clamp how extreme the arena shape can get. An
 *     unclamped ultra-tall phone would produce a sliver arena that plays
 *     badly (hazards crossing it in a blink) - clamping accepts a little
 *     letterboxing at the extremes in exchange for a sane play space.
 *   scale linear zoom factor. <1 shrinks the arena, which makes everything
 *     in it appear proportionally BIGGER on screen - this is the
 *     `mobileArenaScale` knob (see config/global.config.js).
 * @returns {{width:number, height:number}}
 */
export function resolveArena(baseArena, viewportAspect, opts) {
  const { minAspect, maxAspect, scale = 1 } = opts;

  const aspect = Math.min(Math.max(viewportAspect, minAspect), maxAspect);

  // Hold area constant: scale applies to linear dimensions, so its effect
  // on area is scale^2.
  const targetArea = baseArena.width * baseArena.height * scale * scale;

  // Solve { w / h = aspect, w * h = targetArea } for w and h.
  const height = Math.sqrt(targetArea / aspect);
  const width = height * aspect;

  return { width, height };
}
