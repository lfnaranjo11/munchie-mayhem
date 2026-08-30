import { deepMerge } from '../core/ConfigLoader.js';

/**
 * Builds a minigame's final config from three layers, lowest to highest
 * precedence:
 *   1. globalConfig.movementDefaults  - the baseline "feel" shared by every minigame
 *   2. the minigame's own defaultConfig (config.js next to each minigame) -
 *      can override movement (e.g. faster arena) and adds all of its own
 *      minigame-specific fields
 *   3. globalConfig.perMinigameOverrides[id] - a variant deployment's
 *      per-minigame tweaks (config/variants/*.json), highest priority
 *      since that's "this specific site's deliberate change"
 *
 * Every minigame's config.js calls this with its own id + defaults, so
 * this logic (and the precedence order) only has to be right in one
 * place.
 */
export function buildMinigameConfig(id, defaultConfig, globalConfig) {
  const movement = { ...globalConfig.movementDefaults, ...defaultConfig.movement };
  const merged = { ...defaultConfig, movement };
  const overrides = globalConfig.perMinigameOverrides?.[id];
  return overrides ? deepMerge(merged, overrides) : merged;
}
