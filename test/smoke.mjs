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
import { resolveDeviceProfile, applyInputOverride } from '../src/core/deviceProfile.js';
import { CompositeInput } from '../src/core/CompositeInput.js';
import { resolveArena } from '../src/core/arenaFit.js';

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

/**
 * The device profile drives real gameplay decisions (how many humans can
 * play, whether touch controls appear), so it's worth pinning down. It's
 * a pure function precisely so it can be tested here with no browser.
 */
function testDeviceProfile() {
  const phonePortrait = resolveDeviceProfile({ width: 390, height: 844, hasTouch: true, hasFinePointer: false });
  assert.strictEqual(phonePortrait.isTouch, true, 'phone should use touch controls');
  assert.strictEqual(phonePortrait.maxLocalPlayers, 1, 'a phone is one persons device - 1 human + bots');
  assert.strictEqual(phonePortrait.isCompact, true);
  assert.strictEqual(phonePortrait.isPortrait, true);
  assert.strictEqual(phonePortrait.showNameLabels, false, 'labels are illegible on a phone-sized canvas');

  const phoneLandscape = resolveDeviceProfile({ width: 844, height: 390, hasTouch: true, hasFinePointer: false });
  assert.strictEqual(phoneLandscape.isTouch, true, 'landscape phone still has no mouse');
  assert.strictEqual(phoneLandscape.isPortrait, false);

  const desktop = resolveDeviceProfile({ width: 1440, height: 900, hasTouch: false, hasFinePointer: true });
  assert.strictEqual(desktop.isTouch, false, 'desktop uses the keyboard');
  assert.strictEqual(desktop.maxLocalPlayers, 2, 'desktop supports 2 players on one keyboard');
  assert.strictEqual(desktop.showNameLabels, true);

  // A touchscreen laptop has both; someone on that hardware expects the
  // keyboard, and there's room for two players to share it.
  const touchLaptop = resolveDeviceProfile({ width: 1400, height: 900, hasTouch: true, hasFinePointer: true });
  assert.strictEqual(touchLaptop.isTouch, false, 'large touch laptop should default to keyboard');
  assert.strictEqual(touchLaptop.maxLocalPlayers, 2);

  // A small tablet has a fine pointer (stylus) but not enough width for
  // two people to share a keyboard, so it gets the touch path.
  const smallTablet = resolveDeviceProfile({ width: 700, height: 1000, hasTouch: true, hasFinePointer: true });
  assert.strictEqual(smallTablet.isTouch, true, 'small touch device should use touch even with a fine pointer');

  // The URL override must be able to force either scheme for testing.
  assert.strictEqual(applyInputOverride(desktop, 'touch').isTouch, true);
  assert.strictEqual(applyInputOverride(desktop, 'touch').maxLocalPlayers, 1);
  assert.strictEqual(applyInputOverride(phonePortrait, 'keyboard').isTouch, false);
  assert.strictEqual(applyInputOverride(desktop, null).isTouch, false, 'no override should pass the profile through unchanged');

  console.log('✓ device profile resolves correctly for phone / desktop / hybrid devices');
}

/**
 * CompositeInput must poll EVERY source on isReadyPressed rather than
 * short-circuiting, because TouchInputManager's flag is a one-shot that
 * resets when read - short-circuiting would strand a pending tap.
 */
function testCompositeInput() {
  const makeSource = (dir, ready) => ({
    _ready: ready,
    getDirection: () => dir,
    isReadyPressed() {
      const r = this._ready;
      this._ready = false;
      return r;
    },
  });

  const idle = makeSource({ x: 0, y: 0 }, false);
  const active = makeSource({ x: 1, y: 0 }, false);
  const composite = new CompositeInput([idle, active]);
  assert.deepStrictEqual(composite.getDirection(0), { x: 1, y: 0 }, 'should fall through an idle source to the active one');

  const a = makeSource({ x: 0, y: 0 }, false);
  const b = makeSource({ x: 0, y: 0 }, true);
  const composite2 = new CompositeInput([a, b]);
  assert.strictEqual(composite2.isReadyPressed(0), true, 'a ready on any source counts');
  assert.strictEqual(composite2.isReadyPressed(0), false, 'one-shot flags must be consumed, not repeat');

  console.log('✓ composite input merges sources and consumes one-shot ready flags correctly');
}

/**
 * The arena adapts its aspect ratio to the device so the canvas fills the
 * screen (fixing the "screen within a screen" letterboxing), while holding
 * play AREA constant so no device gets an unfair amount of room.
 */
function testArenaFit() {
  const base = GLOBAL_DEFAULTS.arena;
  const opts = { minAspect: base.minAspect, maxAspect: base.maxAspect };
  const baseArea = base.width * base.height;

  const desktop = resolveArena(base, 1920 / 1080, opts);
  const portrait = resolveArena(base, 390 / 780, opts);
  const landscape = resolveArena(base, 780 / 390, opts);

  for (const [name, a] of [['desktop', desktop], ['portrait', portrait], ['landscape', landscape]]) {
    const area = a.width * a.height;
    assert.ok(Math.abs(area - baseArea) / baseArea < 0.01, `${name}: play area should be preserved (got ${Math.round(area)} vs ${baseArea})`);
  }

  assert.ok(portrait.height > portrait.width, 'a portrait screen should get a taller-than-wide arena');
  assert.ok(landscape.width > landscape.height, 'a landscape screen should get a wider-than-tall arena');

  // Extreme aspects must be clamped, or an ultra-tall phone would produce
  // a sliver arena that plays badly.
  const sliver = resolveArena(base, 0.2, opts);
  const sliverAspect = sliver.width / sliver.height;
  assert.ok(sliverAspect >= base.minAspect - 0.001, `ultra-tall viewport should clamp to minAspect (got ${sliverAspect.toFixed(3)})`);

  // The mobileArenaScale knob shrinks the arena (making entities appear
  // bigger on screen) without changing its shape.
  const zoomed = resolveArena(base, 390 / 780, { ...opts, scale: 0.9 });
  const zoomedArea = zoomed.width * zoomed.height;
  assert.ok(zoomedArea < baseArea, 'scale < 1 should shrink the arena');
  assert.ok(Math.abs(zoomedArea - baseArea * 0.81) / (baseArea * 0.81) < 0.01, 'linear scale 0.9 should give 0.81x area');
  assert.ok(Math.abs(zoomed.width / zoomed.height - portrait.width / portrait.height) < 0.001, 'scale must not change aspect ratio');

  console.log('✓ arena fits device aspect ratios while preserving play area (incl. mobileArenaScale)');
}

/**
 * Regression test for the crown ping-ponging between two overlapping
 * players: a steal must EJECT the crown to a random nearby spot rather
 * than handing it to whoever landed the touch.
 */
function testCrownEject() {
  const def = MINIGAME_REGISTRY.kingOfTheMeal;
  const config = def.buildConfig(GLOBAL_DEFAULTS);
  const arena = {
    width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
    height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
  };
  const players = [createPlayer({ x: 400, y: 300, name: 'A' }), createPlayer({ x: 800, y: 300, name: 'B' })];
  const mg = new def.MinigameClass({
    players,
    arena,
    rng: new RNG(11),
    chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
    config,
    bus: null,
  });
  mg.start();

  // Force a known holder, then have the other player touch them.
  mg.crown.dropped = false;
  mg.crown.holderId = players[0].id;
  mg.transferCooldown = 0;
  players[1].x = players[0].x;
  players[1].y = players[0].y;

  const lossX = players[0].x;
  const lossY = players[0].y;
  mg.updateHeldCrown(1 / 60);

  assert.strictEqual(mg.crown.holderId, null, 'crown must not transfer straight to the toucher');
  assert.strictEqual(mg.crown.dropped, true, 'crown should be loose on the ground after a steal');

  const dist = Math.hypot(mg.crown.x - lossX, mg.crown.y - lossY);
  const minSide = Math.min(arena.width, arena.height);
  assert.ok(dist > minSide * 0.1, `crown should land well away from the loss point (landed ${Math.round(dist)}px away)`);
  assert.ok(
    mg.crown.x >= 0 && mg.crown.x <= arena.width && mg.crown.y >= 0 && mg.crown.y <= arena.height,
    'crown must land inside the arena'
  );

  console.log(`✓ crown ejects to a random spot on steal (${Math.round(dist)}px away), not to the toucher`);
}

testRNGDeterminism();
testEachMinigameRunsHeadless();
testStartedFlagTiming();
testDeviceProfile();
testCompositeInput();
testArenaFit();
testCrownEject();
testTournamentFlow();
console.log('\nAll smoke tests passed.');
