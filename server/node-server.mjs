/**
 * server/node-server.mjs - plain Node + ws adapter around GameRoom.
 *
 * Two jobs:
 *   1. Local development. You can run and play real online matches on
 *      your own machine today, against the same GameRoom code that runs
 *      in production - not a mock.
 *   2. A fallback deployment target. If Cloudflare's timing model gives
 *      trouble, this same file runs on any $4-5/mo VPS unchanged.
 *
 * Run with:  npm run server
 * Then open: http://localhost:5173/?server=ws://localhost:8080
 */
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { GameRoom } from '../src/network/GameRoom.js';
import { SIM_HZ, S2C, ERROR_CODES, PROTOCOL_VERSION, decode, encode, generateRoomCode, normalizeRoomCode } from '../src/network/protocol.js';

const PORT = Number(process.env.PORT || 8080);

/** roomCode -> { room, sockets: Map<connId, ws>, timer } */
const rooms = new Map();

function createRoom(code) {
  const sockets = new Map();
  const room = new GameRoom({
    code,
    send: (connId, msg) => {
      const ws = sockets.get(connId);
      if (ws && ws.readyState === ws.OPEN) ws.send(encode(msg));
    },
    broadcast: (msg) => {
      const payload = encode(msg);
      for (const ws of sockets.values()) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    },
  });

  // Fixed-step loop. setInterval drift is corrected by measuring real
  // elapsed time and stepping the simulation by that much, so a busy
  // event loop slows the tick rate rather than silently running the game
  // in slow motion.
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    try {
      room.tick(dt);
    } catch (err) {
      console.error(`[room ${code}] tick failed:`, err);
    }
  }, 1000 / SIM_HZ);

  const entry = { room, sockets, timer };
  rooms.set(code, entry);
  console.log(`[room ${code}] created (${rooms.size} active)`);
  return entry;
}

function disposeRoom(code) {
  const entry = rooms.get(code);
  if (!entry) return;
  clearInterval(entry.timer);
  rooms.delete(code);
  console.log(`[room ${code}] disposed (${rooms.size} active)`);
}

/** Quick-match: reuse any joinable public room, else open a new one. */
function findQuickMatchRoom() {
  for (const [code, entry] of rooms) {
    if (entry.room.isJoinable()) return code;
  }
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();
  createRoom(code);
  return code;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Munchie Mayhem server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  const connId = randomUUID();
  let joinedCode = null;

  ws.on('message', (raw) => {
    const msg = decode(raw);
    if (!msg) return;

    if (msg.t === 'join') {
      if (msg.v !== PROTOCOL_VERSION) {
        // Fail loudly on a stale cached client rather than letting it
        // misbehave in confusing ways.
        ws.send(encode({ t: S2C.ERROR, code: ERROR_CODES.VERSION_MISMATCH, expected: PROTOCOL_VERSION }));
        ws.close();
        return;
      }

      const code = msg.quick ? findQuickMatchRoom() : normalizeRoomCode(msg.roomCode) || generateRoomCode();
      let entry = rooms.get(code);
      if (!entry) {
        // Joining a specific code that doesn't exist creates it - that's
        // how "share a code with a friend" works without a separate
        // create-room step.
        entry = createRoom(code);
      }

      // Register the socket BEFORE addPlayer: addPlayer immediately sends
      // WELCOME through room.send(), which looks the socket up by connId.
      // Registering afterwards meant that first message was silently
      // dropped and the client hung forever waiting for it.
      entry.sockets.set(connId, ws);
      const result = entry.room.addPlayer(connId, msg.name);
      if (!result.ok) {
        entry.sockets.delete(connId);
        ws.send(encode({ t: S2C.ERROR, code: ERROR_CODES.ROOM_FULL }));
        return;
      }
      joinedCode = code;
      return;
    }

    if (!joinedCode) return;
    rooms.get(joinedCode)?.room.handleMessage(connId, msg);
  });

  ws.on('close', () => {
    if (!joinedCode) return;
    const entry = rooms.get(joinedCode);
    if (!entry) return;
    entry.sockets.delete(connId);
    entry.room.removePlayer(connId);
    if (entry.sockets.size === 0) disposeRoom(joinedCode);
  });

  ws.on('error', (err) => console.error('[socket]', err.message));
});
