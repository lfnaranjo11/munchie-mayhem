/**
 * registry.js - every minigame in the rotation, in one place.
 *
 * This is the ONLY file that needs a new entry when you add a minigame -
 * TournamentManager, the menu screen, and the instructions screen all
 * read from here rather than hardcoding a list. See README.md "Adding a
 * new minigame" for the full walkthrough.
 */
import { OrganicDisposal } from './organicDisposal/OrganicDisposal.js';
import { buildOrganicDisposalConfig } from './organicDisposal/config.js';
import { PepperToDie } from './pepperToDie/PepperToDie.js';
import { buildPepperToDieConfig } from './pepperToDie/config.js';
import { ExplodingFruits } from './explodingFruits/ExplodingFruits.js';
import { buildExplodingFruitsConfig } from './explodingFruits/config.js';
import { KetchinUp } from './ketchinUp/KetchinUp.js';
import { buildKetchinUpConfig } from './ketchinUp/config.js';
import { KingOfTheMeal } from './kingOfTheMeal/KingOfTheMeal.js';
import { buildKingOfTheMealConfig } from './kingOfTheMeal/config.js';

export const MINIGAME_REGISTRY = {
  organicDisposal: {
    id: 'organicDisposal',
    title: 'Organic Disposal',
    icon: '🍆',
    instructions: [
      "Don't get caught by the grinders on the left.",
      'Random food will drift in and bounce or drag you depending on how it hits you.',
    ],
    MinigameClass: OrganicDisposal,
    buildConfig: buildOrganicDisposalConfig,
  },
  pepperToDie: {
    id: 'pepperToDie',
    title: 'Pepper To Die',
    icon: '🌶️',
    instructions: [
      'Grab the pepper to become a juggernaut on fire.',
      'Touching another player while on fire eliminates them.',
      "If your timer runs out first, you're the one who dies.",
      "Nobody grabbing it? It'll start hunting someone down.",
    ],
    MinigameClass: PepperToDie,
    buildConfig: buildPepperToDieConfig,
  },
  explodingFruits: {
    id: 'explodingFruits',
    title: 'Exploding Fruits',
    icon: '🍉',
    instructions: ['A bomb will mark a random player out of nowhere.', 'Run clear before it detonates.', 'Explosions leave permanent craters - falling in is fatal.'],
    MinigameClass: ExplodingFruits,
    buildConfig: buildExplodingFruitsConfig,
  },
  ketchinUp: {
    id: 'ketchinUp',
    title: "Ketchin' Up",
    icon: '🍅',
    instructions: ['Avoid the ketchup beam!', 'Hide behind the chocolate - once struck, it goes flying (but stays harmless to touch).', 'Only the beam itself is lethal.'],
    MinigameClass: KetchinUp,
    buildConfig: buildKetchinUpConfig,
  },
  kingOfTheMeal: {
    id: 'kingOfTheMeal',
    title: 'King of the Meal',
    icon: '👑',
    instructions: ['The crown starts on the ground - be first to grab it!', 'Hold it to score. Getting touched drops it.'],
    MinigameClass: KingOfTheMeal,
    buildConfig: buildKingOfTheMealConfig,
  },
};
