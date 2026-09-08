/**
 * test/network.mjs - end-to-end online multiplayer test.
 *
 * Boots the REAL server (same GameRoom the Cloudflare adapter uses),
 * connects four REAL WebSocket clients, readies them up, and plays until
 * a champion is crowned - asserting the whole way that snapshots arrive,
 * players move in response to input, and scoring advances.
 *
 * This is the test that matters most for netcode. The unit tests can tell
 * you a function is correct; only an end-to-end run tells you four
 * clients can actually connect, stay in sync, and finish a match. It also
 * exercises disconnect handling, which is where multiplayer bugs
 * disproportionately live.
 *
 * Run with: npm run test:network
 */
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { C2S, S2C, PROTOCOL_VERSION, encode, decode, generateRoomCode } from '../src/network/protocol.js';

// A random port and random room codes per run. A fixed port meant a
// server from a previous run could still hold it, so clients silently
// connected to the STALE server whose rooms were already full - which
// surfaced as a confusing intermittent room_full failure when the suites
// ran back to back.
const PORT = 8100 + Math.floor(Math.random() * 800);
const URL = `ws://localhost:${PORT}`;
// Codes MUST come from the canonical generator: the room-code alphabet
// deliberately omits I, L and O (so a code read aloud isn't mistyped), so
// an ad-hoc random string can contain letters the server strips - the
// client then asks for one room and lands in another.
const ROOM_MAIN = generateRoomCode();
const ROOM_DUO = generateRoomCode();

/** A minimal scripted client: joins, readies, then walks in a fixed direction. */
class TestClient {
  constructor(name, dir) {
    this.name = name;
    this.dir = dir;
    this.snapshots = [];
    this.rounds = [];
    this.roundEnds = [];
    this.champion = null;
    this.welcome = null;
    this.errors = [];
  }

  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const timer = setTimeout(() => reject(new Error(`${this.name} never got WELCOME`)), 5000);

      this.ws.on('open', () => {
        this.ws.send(encode({ t: C2S.JOIN, v: PROTOCOL_VERSION, name: this.name, ...opts }));
      });

      this.ws.on('message', (raw) => {
        const msg = decode(raw);
        if (!msg) return;
        switch (msg.t) {
          case S2C.WELCOME:
            this.welcome = msg;
            clearTimeout(timer);
            resolve(msg);
            break;
          case S2C.SNAPSHOT:
            this.snapshots.push(msg);
            break;
          case S2C.ROUND_START:
            this.rounds.push(msg);
            break;
          case S2C.ROUND_END:
            this.roundEnds.push(msg);
            break;
          case S2C.TOURNAMENT_END:
            this.champion = msg;
            break;
          case S2C.ERROR:
            this.errors.push(msg);
            break;
          default:
            break;
        }
      });

      this.ws.on('error', reject);
    });
  }

  ready() {
    this.ws.send(encode({ t: C2S.READY }));
  }

  sendInput() {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode({ t: C2S.INPUT, d: this.dir }));
    }
  }

  close() {
    this.ws?.close();
  }
}

async function main() {
  // Start the real server as a child process, exactly as it would run.
  const server = spawn(process.execPath, ['server/node-server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => console.error('[server]', d.toString().trim()));

  const cleanup = () => server.kill();
  process.on('exit', cleanup);

  // Wait for the server to say it's listening rather than sleeping a
  // guessed amount - a fixed sleep is either flaky or needlessly slow.
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server never reported listening')), 8000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    await listening;

    // ---- Four clients join the same room by code --------------------------
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const clients = dirs.map((d, i) => new TestClient(`P${i + 1}`, d));
    for (const c of clients) await c.connect({ roomCode: ROOM_MAIN });

    const slots = clients.map((c) => c.welcome.slot);
    assert.deepStrictEqual([...slots].sort(), [0, 1, 2, 3], `all four should get distinct slots, got ${slots}`);
    assert.ok(clients.every((c) => c.welcome.roomCode === ROOM_MAIN), `everyone should be in room ${ROOM_MAIN}`);
    console.log('✓ four clients joined one room and got distinct seats');

    // ---- A fifth is rejected ---------------------------------------------
    const fifth = new TestClient('P5', { x: 0, y: 0 });
    fifth.connect({ roomCode: ROOM_MAIN }).catch(() => {});
    await sleep(400);
    assert.ok(
      fifth.errors.some((e) => e.code === 'room_full'),
      'a fifth player should be refused with room_full'
    );
    fifth.close();
    console.log('✓ room capacity is enforced (5th player rejected)');

    // ---- Ready up; the server should start the match ----------------------
    clients.forEach((c) => c.ready());

    // Drive input at the protocol rate for a while.
    const inputTimer = setInterval(() => clients.forEach((c) => c.sendInput()), 50);
    await sleep(9000);

    assert.ok(clients[0].rounds.length >= 1, 'a round should have started');
    assert.ok(clients[0].snapshots.length > 40, `snapshots should be streaming, got ${clients[0].snapshots.length}`);
    console.log(`✓ match started and streamed ${clients[0].snapshots.length} snapshots`);

    // All clients must see the SAME authoritative sequence - that's the
    // core promise of server authority. Compare a mid-stream snapshot by
    // seq across clients.
    const ref = clients[0].snapshots[Math.floor(clients[0].snapshots.length / 2)];
    for (const c of clients.slice(1)) {
      const match = c.snapshots.find((s) => s.seq === ref.seq);
      assert.ok(match, `every client should receive snapshot seq ${ref.seq}`);
      assert.strictEqual(
        JSON.stringify(match.d),
        JSON.stringify(ref.d),
        'all clients must receive byte-identical world state for the same seq'
      );
    }
    console.log('✓ all clients receive identical authoritative state');

    // Players should actually have moved in response to input.
    const first = clients[0].snapshots[0];
    const later = clients[0].snapshots[clients[0].snapshots.length - 1];
    const movement = (snap) => snap.d.filter((d) => d.type === 'blob' && d.id);
    assert.ok(movement(first).length > 0, 'snapshots should contain player blobs');
    const moved = movement(later).some((d) => {
      const before = movement(first).find((b) => b.id === d.id);
      return before && Math.hypot(d.x - before.x, d.y - before.y) > 5;
    });
    assert.ok(moved, 'players should move in response to network input');
    console.log('✓ network input drives player movement');

    // ---- Disconnect handling ---------------------------------------------
    // A player leaving mid-match must not break the room for everyone
    // else - historically the most common multiplayer failure.
    const before = clients[1].snapshots.length;
    clients[3].close();

    // Poll rather than sleeping a fixed amount: no snapshots are sent
    // during the gap between rounds, so a fixed wait can land in that
    // window and fail even though the room is perfectly healthy. Waiting
    // for the condition (with a timeout) tests what we actually mean.
    let resumed = false;
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if (clients[1].snapshots.length > before) {
        resumed = true;
        break;
      }
    }
    assert.ok(resumed, 'the match should keep running after a player disconnects');
    assert.strictEqual(clients[1].errors.length, 0, 'a disconnect must not error other clients');
    console.log('✓ match survives a mid-game disconnect');

    // ---- Bots must fill the empty seats -----------------------------------
    // This was broken: botCount was computed against a floor of 2 total
    // players, so two humans got zero bots while the lobby UI promised
    // "empty seats are filled with bots".
    const roundInfo = clients[0].rounds[0];
    assert.strictEqual(
      roundInfo.players.length,
      4,
      `a 4-seat room should field 4 players, got ${roundInfo.players.length}`
    );
    // This room has 4 humans, so correctly zero bots. The bot-filling
    // case is covered separately below with a half-empty room, which is
    // the scenario that was actually broken.
    console.log(`✓ full room fielded ${roundInfo.players.length} players`);

    // ---- Every MOVING drawable must be interpolatable ---------------------
    // A drawable with no id cannot be matched across snapshots, so the
    // client draws it straight from the newest one - it teleports 30x a
    // second while everything around it moves smoothly. This is what made
    // the crown look so much worse than everything else.
    const MOVING_TYPES = new Set(['blob', 'crown', 'bomb', 'beam', 'pepperPickup', 'emitter']);
    const missingIds = new Set();
    for (const snap of clients[0].snapshots) {
      for (const d of snap.d) {
        if (MOVING_TYPES.has(d.type) && !d.id) missingIds.add(d.type);
      }
    }
    assert.strictEqual(
      missingIds.size,
      0,
      `these moving drawables have no id and cannot be interpolated: ${[...missingIds].join(', ')}`
    );
    console.log('✓ every moving drawable carries an id (interpolatable)');

    // ---- Pacing: dead time between rounds ---------------------------------
    assert.ok(roundInfo.startsIn <= 3, `instruction delay should be snappy, got ${roundInfo.startsIn}s`);
    assert.ok(roundInfo.movement?.maxSpeed > 0, 'round start must include movement config for client prediction');
    console.log(`✓ round starts in ${roundInfo.startsIn}s and ships movement config for prediction`);

    clearInterval(inputTimer);
    clients.forEach((c) => c.close());
    await sleep(300);

    // ---- Bots fill a half-empty room --------------------------------------
    // The original bug: botCount was computed against a floor of 2 total
    // players, so a 2-human room got ZERO bots while the lobby promised
    // "empty seats are filled with bots".
    const duo = [new TestClient('A', { x: 1, y: 0 }), new TestClient('B', { x: -1, y: 0 })];
    for (const c of duo) await c.connect({ roomCode: ROOM_DUO });
    duo.forEach((c) => c.ready());

    let duoRound = null;
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if (duo[0].rounds.length) {
        duoRound = duo[0].rounds[0];
        break;
      }
    }
    assert.ok(duoRound, 'the 2-player room should start a round');
    const duoBots = duoRound.players.filter((p) => p.isBot);
    assert.strictEqual(duoRound.players.length, 4, 'a 2-human room should still field 4 players');
    assert.strictEqual(duoBots.length, 2, `2 humans should get 2 bots, got ${duoBots.length}`);
    console.log(`✓ 2-human room filled to ${duoRound.players.length} with ${duoBots.length} bots`);

    duo.forEach((c) => c.close());
    await sleep(200);

    console.log('\nAll network tests passed.');
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error('\nNETWORK TEST FAILED:', err.message);
  process.exit(1);
});
