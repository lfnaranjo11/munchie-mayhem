/**
 * test/smoke.mjs - headless regression test, run with `npm test`.
 *
 * This deliberately imports NOTHING from src/engine or src/ui: it's proof
 * that every minigame's simulation runs correctly with zero DOM/canvas
 * available at all (this file runs in plain Node), which is the whole
 * point of separating game logic from graphics. If a future change
 * accidentally makes a minigame reach for `document` or `window`, this
 * test starts throwing immediately.
 */
import assert from 'node:assert';
import { RNG } from '../src/core/RNG.js';
import { ChaosDirector } from '../src/core/ChaosDirector.js';
import { createPlayer } from '../src/core/Entity.js';
import { MINIGAME_REGISTRY } from '../src/minigames/registry.js';
import { GLOBAL_DEFAULTS } from '../config/global.config.js';
import { TournamentManager } from '../src/tournament/TournamentManager.js';

function fakeInputs(players) {
  const out = {};
  for (const p of players) out[p.id] = { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 };
  return out;
}

function testRNGDeterminism() {
  const a = new RNG(42);
  const b = new RNG(42);
  for (let i = 0; i < 50; i++) assert.strictEqual(a.next(), b.next());
  console.log('✓ RNG is deterministic given the same seed');
}

function testEachMinigameRunsHeadless() {
  for (const id of Object.keys(MINIGAME_REGISTRY)) {
    const def = MINIGAME_REGISTRY[id];
    const rng = new RNG(1);
    const chaos = new ChaosDirector(GLOBAL_DEFAULTS.chaos);
    const config = def.buildConfig(GLOBAL_DEFAULTS);
    const arena = {
      width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
      height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
    };
    const players = [0, 1, 2, 3].map((i) => createPlayer({ x: 100 + i * 150, y: 120 + i * 60, name: `P${i}` }));

    const mg = new def.MinigameClass({ players, arena, rng, chaos, config, bus: null });
    mg.onStart();

    let steps = 0;
    // 150 simulated seconds comfortably clears every minigame's maxDuration
    // (the longest today is King of the Meal at 120s) with margin to spare.
    const maxSteps = 150 * 60;
    while (steps < maxSteps && !mg.isFinished()) {
      mg.step(1 / 60, fakeInputs(players));
      for (const p of players) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${id}: player position became non-finite`);
      }
      steps++;
    }

    const drawables = mg.getDrawables();
    assert.ok(Array.isArray(drawables), `${id}: getDrawables() must return an array`);
    assert.ok(mg.isFinished(), `${id}: round should have concluded within ${maxSteps} steps`);

    console.log(`✓ ${id} ran ${steps} headless steps and concluded cleanly (alive=${mg.getAlivePlayers().length})`);
  }
}

function testTournamentFlow() {
  const tm = new TournamentManager({
    targetScore: 2,
    humanPlayers: 0,
    botCount: 4,
    enabledMinigames: Object.keys(MINIGAME_REGISTRY),
    seed: 7,
    globalConfig: GLOBAL_DEFAULTS,
  });

  let ended = false;
  tm.on('tournament:end', () => {
    ended = true;
  });

  const stubInputSource = { getDirection: () => ({ x: 0, y: 0 }) };
  let roundsPlayed = 0;
  const maxRounds = 30;

  tm.startNextRound();
  while (!ended && roundsPlayed < maxRounds) {
    tm.beginRound();
    let ticks = 0;
    while (tm.isRoundActive() && ticks < 20000) {
      tm.update(1 / 60, tm.collectInputs(stubInputSource));
      ticks++;
    }
    assert.ok(!tm.isRoundActive(), 'round should have concluded well within the safety tick cap');
    roundsPlayed++;
    if (!ended) tm.continueTournament();
  }

  assert.ok(ended, `tournament should reach a champion within ${maxRounds} rounds (bots only)`);
  console.log(`✓ full tournament flow (bots only) reached a champion in ${roundsPlayed} rounds`);
}

/**
 * Regression test for a real bug: the render loop used to call
 * getDrawables() as soon as a minigame existed, rather than once it had
 * actually started - onStart() (which initializes hazards/obstacles/etc.)
 * only runs later, in beginRound(). Calling getDrawables() before that
 * threw on every minigame, and because that throw happened inside a
 * requestAnimationFrame callback, it silently killed the entire render
 * loop - "empty canvas" that never got the chance to re-render again. See
 * MinigameBase.started / start() and the render() guard in main.js.
 */
function testStartedFlagTiming() {
  for (const id of Object.keys(MINIGAME_REGISTRY)) {
    const tm = new TournamentManager({
      targetScore: 1,
      humanPlayers: 0,
      botCount: 2,
      enabledMinigames: [id],
      seed: 3,
      globalConfig: GLOBAL_DEFAULTS,
    });
    tm.startNextRound();
    // This is the exact flag main.js's render() checks before calling
    // getDrawables(). It must be false here - a caller assuming it's
    // safe to draw a minigame whose onStart() hasn't run yet is
    // precisely what caused the empty-canvas bug.
    assert.strictEqual(tm.currentMinigame.started, false, `${id}: must not be marked started until beginRound() runs`);

    tm.beginRound();
    assert.strictEqual(tm.currentMinigame.started, true, `${id}: must be marked started once beginRound() has run`);
    assert.doesNotThrow(() => tm.currentMinigame.getDrawables(), `${id}: getDrawables() must be safe once started`);
  }
  console.log('✓ started flag timing is correct for every minigame (regression test for the empty-canvas bug)');
}

testRNGDeterminism();
testEachMinigameRunsHeadless();
testStartedFlagTiming();
testTournamentFlow();
console.log('\nAll smoke tests passed.');
