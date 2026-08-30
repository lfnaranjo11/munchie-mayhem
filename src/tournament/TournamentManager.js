import { RNG } from '../core/RNG.js';
import { ChaosDirector } from '../core/ChaosDirector.js';
import { EventBus } from '../core/EventBus.js';
import { BotBrain } from '../ai/BotBrain.js';
import { createPlayer } from '../core/Entity.js';
import { MINIGAME_REGISTRY } from '../minigames/registry.js';

const PALETTE = ['#ff6b6b', '#4dd4ac', '#4d9de0', '#f4c150', '#c789e8', '#ff9f68'];

/**
 * TournamentManager - "you choose a number of points, minigames appear at
 * random, first to X round wins takes the tournament."
 *
 * Owns the persistent player list (scores carry across rounds), decides
 * which minigame runs next, constructs each minigame with a fresh
 * per-round RNG/ChaosDirector, and merges human keyboard input with bot
 * AI input into the single {playerId: {x,y}} shape every minigame
 * expects. Talks to the UI only through the inherited EventBus - it has
 * no idea the DOM exists.
 */
export class TournamentManager extends EventBus {
  constructor({ targetScore = 3, humanPlayers = 2, botCount = 2, enabledMinigames, seed, globalConfig }) {
    super();
    this.targetScore = targetScore;
    this.globalConfig = globalConfig;

    const rootSeed = seed ?? Date.now();
    // One RNG sequences "which minigame, what per-round seed" (the
    // tournament's own meta-randomness); a second, independently-seeded
    // one drives bot wandering, so tweaking bot behaviour later can't
    // accidentally shift which minigames get picked.
    this.masterRng = new RNG(rootSeed);
    this.botBrain = new BotBrain(new RNG(rootSeed ^ 0x9e3779b9));

    this.roundIndex = 0;
    this.enabledIds = enabledMinigames?.length ? enabledMinigames : Object.keys(MINIGAME_REGISTRY);
    this.lastMinigameId = null;
    this.players = this.buildPlayers(humanPlayers, botCount);
    this.currentMinigame = null;
    this.phase = 'idle'; // 'idle' | 'instructions' | 'playing' | 'results' | 'finished'
  }

  buildPlayers(humanCount, botCount) {
    const players = [];
    for (let i = 0; i < humanCount; i++) {
      const p = createPlayer({ name: `Player ${i + 1}`, color: PALETTE[i % PALETTE.length] });
      p.inputSlot = i;
      players.push(p);
    }
    for (let i = 0; i < botCount; i++) {
      const p = createPlayer({ name: `Bot ${i + 1}`, color: PALETTE[(humanCount + i) % PALETTE.length] });
      p.isBot = true;
      players.push(p);
    }
    return players;
  }

  pickNextMinigameId() {
    // Avoid an immediate repeat unless it's the only minigame enabled.
    const pool = this.enabledIds.filter((id) => id !== this.lastMinigameId || this.enabledIds.length === 1);
    return pool[this.masterRng.int(0, pool.length - 1)];
  }

  startNextRound() {
    this.roundIndex += 1;
    const id = this.pickNextMinigameId();
    this.lastMinigameId = id;
    const def = MINIGAME_REGISTRY[id];

    const roundSeed = this.masterRng.int(0, 2 ** 31 - 1);
    const rng = new RNG(roundSeed);
    const chaos = new ChaosDirector(this.globalConfig.chaos);
    const config = def.buildConfig(this.globalConfig);
    const arena = {
      width: this.globalConfig.arena.width * (config.arenaScale ?? 1),
      height: this.globalConfig.arena.height * (config.arenaScale ?? 1),
    };

    // Reset per-round player state and scatter everyone near the middle
    // (arena size can differ per minigame, e.g. King of the Meal's +10%,
    // so stale positions from the last round could otherwise land
    // somebody out of bounds).
    for (const p of this.players) {
      p.alive = true;
      p.vx = 0;
      p.vy = 0;
      p.x = arena.width / 2 + rng.range(-100, 100);
      p.y = arena.height / 2 + rng.range(-100, 100);
      p.roundState = {};
    }

    this.currentMinigame = new def.MinigameClass({ players: this.players, arena, rng, chaos, config, bus: this });
    this.currentMinigame.meta = def;
    this.phase = 'instructions';
    this.emit('round:instructions', { def, config });
  }

  beginRound() {
    this.phase = 'playing';
    this.currentMinigame.start();
  }

  isRoundActive() {
    return this.phase === 'playing';
  }

  /**
   * Merges local keyboard input (for human slots) with AI input (for
   * bots) into the flat {playerId: {x,y}} shape every minigame's
   * update(dt, inputs) expects. `inputSource` just needs a
   * getDirection(slot) method - in practice this is always the app's
   * single InputManager instance, but keeping it as a parameter (rather
   * than importing InputManager here) keeps this file DOM-free and easy
   * to unit-test (see test/smoke.mjs).
   */
  collectInputs(inputSource) {
    const inputs = {};
    for (const p of this.players) {
      if (!p.alive) {
        inputs[p.id] = { x: 0, y: 0 };
        continue;
      }
      inputs[p.id] = p.isBot ? this.botBrain.decide(p, this.currentMinigame) : inputSource.getDirection(p.inputSlot);
    }
    return inputs;
  }

  update(dt, inputs) {
    if (this.phase !== 'playing') return;
    this.currentMinigame.step(dt, inputs);
    if (this.currentMinigame.isFinished()) this.finishRound();
  }

  finishRound() {
    const result = this.currentMinigame.getResult();
    for (const winnerId of result.winners) {
      const p = this.players.find((pl) => pl.id === winnerId);
      if (p) p.score += 1;
    }
    this.phase = 'results';
    const champion = this.players.find((p) => p.score >= this.targetScore);
    this.emit('round:end', { result, players: this.players, roundIndex: this.roundIndex });
    if (champion) {
      this.phase = 'finished';
      this.emit('tournament:end', champion);
    }
  }

  continueTournament() {
    if (this.phase === 'finished') return;
    this.startNextRound();
  }

  getHUDData() {
    return {
      minigameName: this.currentMinigame?.meta?.title,
      players: this.players,
      targetScore: this.targetScore,
      timeRemaining: this.currentMinigame?.getTimeRemaining?.(),
    };
  }
}
