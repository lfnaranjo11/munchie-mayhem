/**
 * RNG - a small seeded pseudo-random number generator (mulberry32).
 *
 * WHY THIS EXISTS INSTEAD OF Math.random():
 * Every "random" thing in this game - which minigame gets picked next,
 * where a hazard spawns, when a bomb goes off, which obstacle the beam
 * clips - is drawn from one of these. That means:
 *
 *   1. A whole tournament is fully determined by a single integer seed.
 *      Pass the same seed twice and you get the identical sequence of
 *      minigames and events, which is invaluable for reproducing a bug
 *      report or writing a regression test (see test/smoke.mjs).
 *   2. Config variants (config/variants/*.json) can be diffed in git like
 *      any other data, because "randomness" here just means "a plain
 *      config object plus a seed", not hidden engine behaviour.
 *   3. It's a prerequisite for real networked multiplayer later: if two
 *      clients run the same seed and apply the same inputs in the same
 *      order, they simulate identically without ever exchanging game
 *      state (see the "Multiplayer" section in README.md).
 *
 * Never call Math.random() anywhere in game logic - always go through an
 * RNG instance so the guarantees above actually hold.
 */
export class RNG {
  /** @param {number} [seed] defaults to a time-based seed (non-reproducible) */
  constructor(seed = Date.now()) {
    // 0 is a degenerate seed for this algorithm (it would stay 0 forever),
    // so we nudge it to 1 in that case.
    this.seed = (seed >>> 0) || 1;
  }

  /**
   * Returns a float in [0, 1). This is the only place actual entropy is
   * produced; every other method below is built on top of this one.
   */
  next() {
    // mulberry32 - tiny, fast, good-enough statistical quality for game
    // feel (not cryptographic, and doesn't need to be).
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** Picks a uniformly random element from a non-empty array. */
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  /** True with probability p (p is clamped implicitly: p<=0 never, p>=1 always). */
  chance(p) {
    return this.next() < p;
  }

  /** In-place Fisher-Yates shuffle. Returns the same array for convenience. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
