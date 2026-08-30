/**
 * ConfigLoader.js - loads the global config and layers an optional
 * "variant" JSON file on top of it.
 *
 * THIS IS THE A/B-TESTING / MULTI-SITE MECHANISM from the brief ("break
 * minigames out to other websites, small config changes, see what
 * increases traffic - Mr Beast-style SEO experiments"):
 *
 *   index.html?variant=chaotic   -> deep-merges config/variants/chaotic.json
 *                                    over the defaults
 *   index.html?variant=chill     -> config/variants/chill.json
 *   index.html                   -> defaults only
 *
 * Because every tunable number in the game (spawn rates, speeds, chaos
 * ramp, per-minigame overrides) lives in plain config objects rather than
 * hardcoded in game logic, a "variant" is nothing more than a small JSON
 * file - easy to fork per deployment, easy to diff in git, easy to spin up
 * a dozen of for a traffic experiment without touching any code. See
 * config/variants/chaotic.json and config/variants/chill.json for
 * concrete examples, and README.md ("Config variants & A/B testing") for
 * how to add your own.
 */

/**
 * Recursively merges `override` onto `base`. Plain objects merge
 * key-by-key; anything else (arrays, numbers, strings) in `override`
 * simply replaces the value in `base` - so a variant that wants to change
 * one hazard type doesn't need to reproduce the entire hazardTypes array,
 * but if it DOES specify hazardTypes, that whole list is what's used
 * (arrays don't merge element-by-element, which would be surprising).
 */
export function deepMerge(base, override) {
  if (override === undefined) return base;
  const bothPlainObjects =
    typeof base === 'object' && base !== null && !Array.isArray(base) &&
    typeof override === 'object' && override !== null && !Array.isArray(override);
  if (!bothPlainObjects) return override;

  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

/**
 * @param {object} defaultConfig
 * @param {string|null} variantName
 * @returns {Promise<object>} defaultConfig with the variant deep-merged on top,
 *   or defaultConfig unchanged if there's no variant / it fails to load
 *   (a missing or broken variant file should never crash the game - it
 *   just falls back to defaults).
 */
export async function loadConfig(defaultConfig, variantName) {
  if (!variantName) return defaultConfig;
  try {
    const res = await fetch(`./config/variants/${variantName}.json`);
    if (!res.ok) return defaultConfig;
    const variantData = await res.json();
    return deepMerge(defaultConfig, variantData);
  } catch (err) {
    console.warn(`Munchie Mayhem: could not load config variant "${variantName}", using defaults.`, err);
    return defaultConfig;
  }
}

export function getVariantFromURL() {
  return new URLSearchParams(window.location.search).get('variant');
}

/** ?seed=12345 reproduces an exact tournament for debugging/regression testing. */
export function getSeedFromURL() {
  const raw = new URLSearchParams(window.location.search).get('seed');
  return raw ? Number(raw) : undefined;
}
