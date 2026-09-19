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
import { CanvasRenderer } from '../src/engine/CanvasRenderer.js';
import { easeOutQuad, easeOutBack, easeOutElastic, easeOutBounce, stepSpring, approach } from '../src/engine/anim/easing.js';
import { ParticleSystem, ScreenShake } from '../src/engine/anim/ParticleSystem.js';
import { resolveExpression, EXPRESSION } from '../src/engine/anim/VisualState.js';

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
  assert.strictEqual(mg.crown.state, 'hover', 'crown should launch into its hover flight after a steal');

  // The landing spot - not the current position - is what must be far
  // away: the crown starts its flight where it was lost.
  const minSide = Math.min(arena.width, arena.height);
  const throwDist = Math.hypot(mg.crown.targetX - lossX, mg.crown.targetY - lossY);
  assert.ok(
    throwDist >= minSide * 0.4,
    `crown should be thrown well away from the loss point (target ${Math.round(throwDist)}px away)`
  );

  // UNTOUCHABLE in flight: park a player exactly on it and it must not be
  // picked up. This is what stops a fast-moving pickup being un-grabbable
  // online, and stops bots winning every scramble.
  let steps = 0;
  while (mg.crown.state === 'hover' && steps < 600) {
    players[1].x = mg.crown.x;
    players[1].y = mg.crown.y;
    mg.updateDroppedCrown(1 / 60);
    assert.strictEqual(mg.crown.holderId, null, 'a hovering crown must not be grabbable');
    steps++;
  }
  assert.strictEqual(mg.crown.state, 'landed', 'crown should eventually land');
  assert.ok(
    mg.crown.x >= 0 && mg.crown.x <= arena.width && mg.crown.y >= 0 && mg.crown.y <= arena.height,
    'crown must land inside the arena'
  );

  // Landed and stationary, so it can actually be caught.
  const restX = mg.crown.x;
  mg.transferCooldown = 0;
  mg.updateDroppedCrown(1 / 60);
  assert.strictEqual(mg.crown.x, restX, 'a landed crown must not drift - that is what makes it catchable online');

  console.log(`✓ crown flies untouchable then lands ${Math.round(throwDist)}px away and sits still`);
}

/**
 * The animation layer is render-only, but its maths is pure and worth
 * pinning down - a spring that never settles or a particle pool that
 * leaks would both show up as a gradually degrading frame rate rather
 * than an obvious crash.
 */
function testAnimationMath() {
  // Easing curves must hit their endpoints exactly, or animations visibly
  // snap at the end.
  for (const [name, fn] of [['easeOutQuad', easeOutQuad], ['easeOutBack', easeOutBack], ['easeOutElastic', easeOutElastic], ['easeOutBounce', easeOutBounce]]) {
    assert.ok(Math.abs(fn(0) - 0) < 1e-6, `${name}(0) should be 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-6, `${name}(1) should be 1`);
  }
  // easeOutBack is supposed to overshoot past its target and come back.
  let overshot = false;
  for (let t = 0; t <= 1; t += 0.02) if (easeOutBack(t) > 1.001) overshot = true;
  assert.ok(overshot, 'easeOutBack should overshoot before settling');

  // A spring must actually converge, and stay finite doing it.
  const spring = { value: 0, velocity: 0 };
  for (let i = 0; i < 600; i++) stepSpring(spring, 1, 190, 0.82, 1 / 60);
  assert.ok(Number.isFinite(spring.value), 'spring must not diverge to NaN/Infinity');
  assert.ok(Math.abs(spring.value - 1) < 0.02, `spring should settle at its target (got ${spring.value.toFixed(3)})`);

  // approach() must be frame-rate independent: one big step and several
  // small ones covering the same time should land in about the same place.
  const oneBig = approach(0, 1, 0.1, 4);
  let manySmall = 0;
  for (let i = 0; i < 4; i++) manySmall = approach(manySmall, 1, 0.1, 1);
  assert.ok(Math.abs(oneBig - manySmall) < 1e-9, 'approach() must be frame-rate independent');

  console.log('✓ easing curves hit their endpoints, springs converge, approach is frame-rate independent');
}

function testParticlePool() {
  const ps = new ParticleSystem(50);
  // Emitting far more than the pool holds must not grow it - the cap is
  // what bounds the cost of a chaotic moment.
  for (let i = 0; i < 40; i++) ps.emit({ x: 0, y: 0, count: 10 });
  assert.strictEqual(ps.pool.length, 50, 'particle pool must not grow beyond its cap');
  assert.ok(ps.getDrawables().length <= 50, 'never more live particles than the pool holds');

  // Everything must eventually die, or particles accumulate forever.
  for (let i = 0; i < 400; i++) ps.update(1 / 60);
  assert.strictEqual(ps.getDrawables().length, 0, 'all particles should expire');

  // Screen shake must decay to rest rather than shaking forever.
  const shake = new ScreenShake();
  shake.add(1);
  for (let i = 0; i < 200; i++) shake.update(1 / 60);
  assert.strictEqual(shake.trauma, 0, 'screen shake trauma should decay to zero');
  assert.deepStrictEqual(shake.getOffset(), { x: 0, y: 0 }, 'no offset once settled');

  console.log('✓ particle pool is bounded and expires, screen shake decays to rest');
}

function testExpressionPriority() {
  // Danger cues must beat ambient ones - the expression is a gameplay
  // readability signal, not just decoration.
  assert.strictEqual(resolveExpression({ inDanger: true, crowned: true }, 0), EXPRESSION.SCARED, 'danger should outrank the crown');
  assert.strictEqual(resolveExpression({ onFire: true, inDanger: true }, 0), EXPRESSION.DETERMINED, 'being the juggernaut outranks danger');
  assert.strictEqual(resolveExpression({ crowned: true }, 0), EXPRESSION.HAPPY);
  assert.strictEqual(resolveExpression({}, 0.9), EXPRESSION.DETERMINED, 'running flat out should look determined');
  assert.strictEqual(resolveExpression({}, 0), EXPRESSION.NEUTRAL);
  console.log('✓ facial expressions resolve in the right priority order');
}

/**
 * Regression test for "the crown sometimes gets stuck in an obstacle".
 *
 * Root cause was that ejectCrown picked a landing spot using only the
 * arena bounds, so it could land inside an obstacle. Since players
 * collide with obstacles they physically could not reach it, and the
 * round stalled until the timer expired. This drives a long round and
 * asserts the crown is never inside an obstacle on any frame, and that
 * its drift actually moves it and changes direction.
 */
function testCrownNeverStuck() {
  const def = MINIGAME_REGISTRY.kingOfTheMeal;
  const config = def.buildConfig(GLOBAL_DEFAULTS);
  const arena = {
    width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
    height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
  };

  let landings = 0;
  let worstOverlap = 0;
  let shortestThrow = Infinity;
  const spots = new Set();
  const minSide = Math.min(arena.width, arena.height);

  // Drive ejections directly rather than hoping a random walk produces
  // them: an earlier version of this test relied on players bumping into
  // each other, and with per-frame random input they just jitter on the
  // spot, so the crown was never actually thrown and the test proved
  // nothing.
  for (const seed of [1, 7, 13, 42, 99]) {
    const players = [0, 1, 2, 3].map((i) =>
      createPlayer({ x: 120 + i * 130, y: 140 + i * 70, name: `P${i}` })
    );
    const mg = new def.MinigameClass({
      players,
      arena,
      rng: new RNG(seed),
      chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
      config,
      bus: null,
    });
    mg.start();

    for (let throwNo = 0; throwNo < 25; throwNo++) {
      const from = {
        x: 60 + ((throwNo * 137) % (arena.width - 120)),
        y: 60 + ((throwNo * 91) % (arena.height - 120)),
      };
      mg.ejectCrown(from);
      shortestThrow = Math.min(
        shortestThrow,
        Math.hypot(mg.crown.targetX - from.x, mg.crown.targetY - from.y)
      );

      // Fly it to the ground.
      let guard = 0;
      while (mg.crown.state === 'hover' && guard++ < 1000) mg.updateDroppedCrown(1 / 60);
      assert.strictEqual(mg.crown.state, 'landed', `seed ${seed}: crown should land`);

      // A landed crown must be reachable: inside the arena and clear of
      // every obstacle, or players simply cannot get to it.
      assert.ok(
        mg.crown.x >= 0 && mg.crown.x <= arena.width && mg.crown.y >= 0 && mg.crown.y <= arena.height,
        `seed ${seed}: crown landed outside the arena at (${mg.crown.x.toFixed(1)}, ${mg.crown.y.toFixed(1)})`
      );
      for (const obs of mg.obstacles) {
        const d = Math.hypot(mg.crown.x - obs.x, mg.crown.y - obs.y);
        const minDist = obs.radius + mg.crown.radius;
        if (d < minDist) worstOverlap = Math.max(worstOverlap, minDist - d);
      }

      spots.add(`${Math.round(mg.crown.x / 60)},${Math.round(mg.crown.y / 60)}`);
      landings++;
    }
  }

  assert.strictEqual(worstOverlap, 0, `a landed crown must never overlap an obstacle (worst ${worstOverlap.toFixed(2)}px)`);
  assert.ok(
    shortestThrow >= minSide * config.landMinDistance * 0.95,
    `every throw should clear the minimum distance (shortest ${Math.round(shortestThrow)}px)`
  );
  // Varied landings, or every scramble happens in the same corner.
  assert.ok(spots.size > 20, `landings should be spread around the arena (distinct spots: ${spots.size})`);

  console.log(`✓ ${landings} crown landings: all reachable, min throw ${Math.round(shortestThrow)}px, ${spots.size} distinct spots`);
}

/**
 * The animation layer is render-only, but its maths is pure and worth
 * pinning down - a spring that never settles or a particle pool that
 * leaks would both show up as a gradually degrading frame rate rather
 * than an obvious crash.
 */
/**
 * Sauce Splash keeps running coverage totals instead of scanning the grid
 * each frame (a full scan would be ~1000 cells x 60fps x players). That's
 * the right call for performance, but incremental accounting is exactly
 * the kind of thing that drifts silently - a missed decrement would show
 * up only as a percentage bar that slowly stops adding up. So: verify the
 * totals against a real count of the grid.
 */
function testSauceSplashCoverage() {
  const def = MINIGAME_REGISTRY.sauceSplash;
  const config = def.buildConfig(GLOBAL_DEFAULTS);
  const arena = {
    width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
    height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
  };
  const players = [0, 1, 2, 3].map((i) =>
    createPlayer({ x: 150 + i * 180, y: 130 + i * 80, name: `P${i}` })
  );
  const mg = new def.MinigameClass({
    players,
    arena,
    rng: new RNG(5),
    chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
    config,
    bus: null,
  });
  mg.start();

  const rng = new RNG(77);
  for (let frame = 0; frame < 2400; frame++) {
    const inputs = {};
    for (const p of players) {
      // Smooth wandering rather than per-frame noise, so players actually
      // travel and paint (random input every frame just jitters in place).
      const a = rng.range(0, Math.PI * 2) * 0.03 + frame * 0.01 + players.indexOf(p);
      inputs[p.id] = { x: Math.cos(a), y: Math.sin(a) };
    }
    mg.step(1 / 60, inputs);

    if (frame % 400 === 0) {
      // Recount from scratch and compare with the running totals.
      const actual = new Array(players.length + 1).fill(0);
      for (const owner of mg.grid) actual[owner] += 1;
      assert.deepStrictEqual(
        Array.from(mg.counts),
        actual,
        `frame ${frame}: running coverage totals drifted from the real grid`
      );
    }
    if (mg.isFinished()) break;
  }

  const sum = mg.counts.reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, mg.totalCells, 'every cell must be accounted for exactly once');

  const coverage = mg.getCoverage();
  const painted = [...coverage.values()].reduce((a, b) => a + b, 0);
  assert.ok(painted > 0.25, `players should have painted a meaningful area, got ${(painted * 100).toFixed(1)}%`);
  assert.ok(painted <= 1.0001, 'total coverage cannot exceed the whole board');

  // A jar boost must actually widen the brush.
  const target = players[0];
  target.roundState.boost = 0;
  const before = mg.counts[mg.playerIndex.get(target.id)];
  target.x = arena.width * 0.5;
  target.y = arena.height * 0.5;
  mg.paintAround(target, config.brushRadius);
  const normal = mg.counts[mg.playerIndex.get(target.id)] - before;
  target.x = arena.width * 0.2;
  target.y = arena.height * 0.8;
  const beforeBoost = mg.counts[mg.playerIndex.get(target.id)];
  mg.paintAround(target, config.brushRadius * config.jar.brushMultiplier);
  const boosted = mg.counts[mg.playerIndex.get(target.id)] - beforeBoost;
  assert.ok(boosted > normal, `a boosted brush should paint more (${boosted} vs ${normal})`);

  // The winner must be whoever actually owns the most ground.
  const result = mg.getResult();
  let best = null;
  let bestOwned = -1;
  for (const p of players) {
    const owned = mg.counts[mg.playerIndex.get(p.id)];
    if (owned > bestOwned) {
      bestOwned = owned;
      best = p;
    }
  }
  assert.deepStrictEqual(result.winners, [best.id], 'the player owning the most ground should win');

  console.log(
    `\u2713 sauce splash: coverage totals stay exact (${(painted * 100).toFixed(0)}% painted), boost widens brush, winner = most ground`
  );
}

/**
 * Every drawable a minigame emits must have a renderer, and every
 * coordinate must be a real number.
 *
 * WHY THIS EXISTS: mutation testing showed that renaming a drawable type
 * (say `bomb` -> `bomb_TYPO`) passed every single test. CanvasRenderer
 * falls back to a generic grey circle for unknown types, so bombs would
 * silently render as featureless blobs and nothing would fail. That is
 * precisely the class of bug that kept reaching the user: the simulation
 * is perfect, the screen is wrong, and the suite is green.
 *
 * Checking against CanvasRenderer.prototype needs no canvas, so this
 * stays a pure Node test.
 */
function testDrawableContract() {
  const missing = new Map();
  const nonFinite = [];
  let checked = 0;

  for (const id of Object.keys(MINIGAME_REGISTRY)) {
    const def = MINIGAME_REGISTRY[id];
    const config = def.buildConfig(GLOBAL_DEFAULTS);
    const arena = {
      width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
      height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
    };
    const players = [0, 1, 2, 3].map((i) =>
      createPlayer({ x: 120 + i * 150, y: 120 + i * 70, name: `P${i}` })
    );
    const mg = new def.MinigameClass({
      players,
      arena,
      rng: new RNG(9),
      chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
      config,
      bus: null,
    });
    mg.start();

    const rng = new RNG(4);
    // Sample across the whole round, so states that only appear later
    // (a firing beam, a hovering crown, craters) are covered too.
    for (let frame = 0; frame < 3000; frame++) {
      const inputs = {};
      for (const p of players) {
        const a = frame * 0.02 + players.indexOf(p) * 1.7;
        inputs[p.id] = { x: Math.cos(a), y: Math.sin(a) };
      }
      mg.step(1 / 60, inputs);

      if (frame % 25 !== 0) continue;
      for (const d of mg.getDrawables()) {
        checked++;
        if (typeof CanvasRenderer.prototype[`draw_${d.type}`] !== 'function') {
          missing.set(d.type, id);
        }
        for (const [key, value] of Object.entries(d)) {
          if (typeof value === 'number' && !Number.isFinite(value)) {
            nonFinite.push(`${id}: ${d.type}.${key} = ${value}`);
          }
        }
      }
      if (mg.isFinished()) break;
    }
  }

  assert.strictEqual(
    missing.size,
    0,
    `drawable types with no draw_ method (they render as anonymous grey circles): ${[...missing.entries()].map(([t, g]) => `${t} (from ${g})`).join(', ')}`
  );
  assert.strictEqual(nonFinite.length, 0, `non-finite drawable values: ${nonFinite.slice(0, 5).join('; ')}`);
  console.log(`\u2713 all ${checked} sampled drawables have a renderer and finite coordinates`);
}

/**
 * The crown's landing spot must be chosen clear of obstacles.
 *
 * The existing crown test checked the FINAL position, which
 * `_settleCrown()` fixes up afterwards - so deleting the obstacle check
 * inside pickLandingSpot passed every test. Testing the chosen spot
 * directly, before the safety net runs, is what actually pins the
 * behaviour down.
 */
function testCrownLandingSpotIsChosenClear() {
  const def = MINIGAME_REGISTRY.kingOfTheMeal;
  const config = def.buildConfig(GLOBAL_DEFAULTS);
  const arena = {
    width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
    height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
  };
  const players = [0, 1].map((i) => createPlayer({ x: 200 + i * 300, y: 200, name: `P${i}` }));
  const mg = new def.MinigameClass({
    players,
    arena,
    rng: new RNG(21),
    chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
    config,
    bus: null,
  });
  mg.start();

  let blocked = 0;
  for (let i = 0; i < 300; i++) {
    const from = { x: 80 + ((i * 53) % (arena.width - 160)), y: 80 + ((i * 37) % (arena.height - 160)) };
    const spot = mg.pickLandingSpot(from);
    if (mg._isBlocked(spot.x, spot.y)) blocked++;
  }
  assert.strictEqual(blocked, 0, `pickLandingSpot returned ${blocked}/300 spots inside an obstacle`);
  console.log('\u2713 crown landing spots are chosen clear of obstacles (not just fixed up afterwards)');
}

/**
 * Drives each minigame into its CONDITIONAL states and validates the
 * drawables there.
 *
 * WHY: mutation testing showed a NaN injected into Pepper to Die's
 * hunting-pepper code passed every test. That branch only runs after the
 * pepper has sat unclaimed for several seconds - which never happened in
 * the other tests, because wandering players grab it almost immediately.
 * A test that samples "whatever states it happens to reach" silently
 * covers only the easy paths.
 *
 * So this pins the players out of the way to force the timed branches,
 * and then ASSERTS each interesting state was actually observed - if a
 * state stops being reachable, this fails rather than quietly covering
 * less.
 */
function testConditionalStateDrawables() {
  // minigame id -> { states: {name -> predicate}, provoke?: (mg, frame) => void }
  // `provoke` forces states that pinned players can never trigger on
  // their own - the crown only flies when somebody steals it, and nobody
  // steals anything while parked in a corner.
  const STATES = {
    pepperToDie: {
      'pepper hunting': (mg) => mg.pepper?.state === 'hunting',
    },
    kingOfTheMeal: {
      'crown hovering': (mg) => mg.crown?.state === 'hover',
      'crown landed': (mg) => mg.crown?.state === 'landed',
    },
    ketchinUp: {
      'beam firing': (mg) => !mg.repositioning && mg.beamPhase === 'fire',
      'beam charging': (mg) => !mg.repositioning && mg.beamPhase === 'charge',
      'cannon repositioning': (mg) => mg.repositioning === true,
    },
    explodingFruits: {
      'bomb armed': (mg) => mg.bombs?.some((b) => b.phase === 'armed'),
      'crater left behind': (mg) => mg.craters?.length > 0,
    },
    organicDisposal: {
      'hazard in play': (mg) => mg.hazards?.length > 0,
    },
    sauceSplash: {
      'jar available': (mg) => mg.jars?.length > 0,
    },
  };

  const nonFinite = [];

  // Forces states unreachable from a pinned-player simulation.
  const PROVOKE = {
    kingOfTheMeal: (mg, frame) => {
      // Throw the crown periodically so both flight and landing are seen.
      if (frame % 240 === 60) mg.ejectCrown({ x: mg.arena.width / 2, y: mg.arena.height / 2 });
    },
  };

  for (const [id, states] of Object.entries(STATES)) {
    const def = MINIGAME_REGISTRY[id];
    const config = def.buildConfig(GLOBAL_DEFAULTS);
    const arena = {
      width: GLOBAL_DEFAULTS.arena.width * (config.arenaScale ?? 1),
      height: GLOBAL_DEFAULTS.arena.height * (config.arenaScale ?? 1),
    };
    const players = [0, 1, 2, 3].map((i) => createPlayer({ x: 60 + i * 26, y: 60, name: `P${i}` }));
    const mg = new def.MinigameClass({
      players,
      arena,
      rng: new RNG(31),
      chaos: new ChaosDirector(GLOBAL_DEFAULTS.chaos),
      config,
      bus: null,
    });
    mg.start();

    const seen = new Set();
    // Per-minigame, NOT shared: a shared accumulator meant one minigame's
    // NaN aborted every later minigame on frame 0, which then failed with
    // a misleading "never reached state X" instead of the real cause.
    const localNonFinite = [];
    for (let frame = 0; frame < 60 * 40; frame++) {
      // Pin the players in a corner with no input. This is what forces
      // the timed branches: nobody grabs the pickup, nobody dies, and the
      // "if this sits unclaimed" paths finally execute.
      const inputs = {};
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        p.x = 60 + i * 26;
        p.y = 60;
        p.vx = 0;
        p.vy = 0;
        p.alive = true;
        inputs[p.id] = { x: 0, y: 0 };
      }
      PROVOKE[id]?.(mg, frame);
      mg.update(1 / 60, inputs);

      for (const [name, predicate] of Object.entries(states)) {
        if (predicate(mg)) seen.add(name);
      }

      for (const d of mg.getDrawables()) {
        for (const [key, value] of Object.entries(d)) {
          if (typeof value === 'number' && !Number.isFinite(value)) {
            localNonFinite.push(`${id}: ${d.type}.${key} = ${value} (frame ${frame})`);
          }
        }
      }
      if (localNonFinite.length) break;
    }

    nonFinite.push(...localNonFinite);
    // Only meaningful if this minigame ran to completion; a NaN abort
    // legitimately cuts the run short.
    if (localNonFinite.length === 0)
      for (const name of Object.keys(states)) {
      assert.ok(
        seen.has(name),
        `${id}: never reached the "${name}" state - this test is no longer covering that branch`
      );
    }
  }

  assert.strictEqual(
    nonFinite.length,
    0,
    `non-finite values in conditional states: ${nonFinite.slice(0, 3).join('; ')}`
  );
  console.log('\u2713 conditional states (hunting pepper, hovering crown, firing beam, craters...) all reached and finite');
}

testRNGDeterminism();
testEachMinigameRunsHeadless();
testStartedFlagTiming();
testDeviceProfile();
testCompositeInput();
testArenaFit();
testCrownEject();
testCrownNeverStuck();
testSauceSplashCoverage();
testDrawableContract();
testConditionalStateDrawables();
testCrownLandingSpotIsChosenClear();
testAnimationMath();
testParticlePool();
testExpressionPriority();
testTournamentFlow();
console.log('\nAll smoke tests passed.');
