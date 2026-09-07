/**
 * characters.js - the character roster and shared animation tuning.
 *
 * ── DESIGN NOTE ──────────────────────────────────────────────────────
 * These are ORIGINAL designs, not reproductions of any existing game's
 * artwork. Game mechanics aren't protected and reimplementing them is
 * fine, but character art is - so this roster is built from generic food
 * silhouettes (a round tomato, a cheese wedge, a bun) drawn procedurally
 * from the parameters below. If you later commission or draw real
 * sprites, replace the art without touching gameplay: see the
 * `SpriteProvider` seam described in CanvasRenderer.js.
 *
 * ── ADDING A CHARACTER ───────────────────────────────────────────────
 * Add an entry here. Nothing else needs to change - TournamentManager
 * assigns characters to players from this list, and the renderer draws
 * whatever shape/topping combination it finds. That's the same
 * data-over-code approach used for minigame configs, and it means a
 * config variant can ship a different roster per deployment for A/B
 * testing (see README "Config variants & A/B testing").
 *
 * Fields:
 *   body      'round' | 'wedge' | 'tall' | 'squat' - the silhouette
 *   fill      main body colour
 *   shade     darker tone for the bottom third, for a soft 3D read
 *   topping   'sprout' | 'leaf' | 'drip' | 'swirl' | 'none' - the bit on top
 *   toppingColor
 *   accent    freckles/holes/seeds scattered on the body ('none' to skip)
 */

export const CHARACTERS = [
  {
    id: 'tomo',
    name: 'Tomo',
    body: 'round',
    fill: '#ff6b6b',
    shade: '#e04f4f',
    topping: 'leaf',
    toppingColor: '#5fbf6a',
    accent: 'none',
  },
  {
    id: 'chedd',
    name: 'Chedd',
    body: 'wedge',
    fill: '#f7c948',
    shade: '#e0ac2b',
    topping: 'none',
    toppingColor: '#e0ac2b',
    accent: 'holes',
  },
  {
    id: 'spud',
    name: 'Spud',
    body: 'squat',
    fill: '#e8c98f',
    shade: '#cfa969',
    topping: 'sprout',
    toppingColor: '#7fbf6a',
    accent: 'freckles',
  },
  {
    id: 'bloob',
    name: 'Bloob',
    body: 'round',
    fill: '#68c3e8',
    shade: '#4aa3c8',
    topping: 'drip',
    toppingColor: '#ffffff',
    accent: 'none',
  },
  {
    id: 'brocc',
    name: 'Brocc',
    body: 'tall',
    fill: '#7fbf6a',
    shade: '#63a04f',
    topping: 'swirl',
    toppingColor: '#4f8a3f',
    accent: 'freckles',
  },
  {
    id: 'plum',
    name: 'Plum',
    body: 'round',
    fill: '#c789e8',
    shade: '#a568c8',
    topping: 'leaf',
    toppingColor: '#7fbf6a',
    accent: 'none',
  },
];

/**
 * Shared animation tuning. Every value here is a "feel" knob - these are
 * the numbers to reach for when the characters look stiff or too rubbery.
 */
export const ANIMATION_DEFAULTS = {
  // Squash & stretch
  stretchPerSpeed: 0.16, // how much a character elongates at full speed
  impactThreshold: 40, // deceleration (px/s per frame) that counts as a hit
  impactSquash: 0.9, // squash impulse strength on impact
  squashStiffness: 190, // spring pull back to rest - higher = snappier
  squashDamping: 0.82, // lower = wobblier / more oscillation

  // Leaning into movement
  maxTilt: 0.22, // radians at full speed
  tiltStiffness: 120,
  tiltDamping: 0.85,

  // Idle life
  bobSpeed: 4.5,
  bobAmount: 1.8, // px

  // Blinking
  blinkIntervalMin: 1.8,
  blinkIntervalMax: 5.5,
  blinkRecover: 0.35, // how fast eyes reopen

  // Effects
  dustSpeedThreshold: 0.55, // fraction of max speed before kicking up dust
  impactParticleThreshold: 90, // deceleration that spawns impact sparks
  shakeOnExplosion: 0.55,
  shakeOnElimination: 0.3,
};
