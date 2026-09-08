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
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { GameRoom } from '../src/network/GameRoom.js';
import { SIM_HZ, S2C, ERROR_CODES, PROTOCOL_VERSION, decode, encode, generateRoomCode, normalizeRoomCode } from '../src/network/protocol.js';

// Cloud Run (and most PaaS) inject the port to listen on. Never hardcode it.
const PORT = Number(process.env.PORT || 8080);
// Must bind 0.0.0.0, not localhost: a container listening only on the
// loopback interface is unreachable from outside, and the platform's
// startup probe will fail with no obvious error.
const HOST = process.env.HOST || '0.0.0.0';

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
      // Cost control: close rooms nobody is actually using. An open
      // WebSocket keeps a serverless instance alive and billing, so an
      // abandoned tab is a slow money leak.
      if (room.expired) {
        console.log(`[room ${code}] closing (${room.expiryReason})`);
        for (const ws of sockets.values()) {
          try {
            ws.send(encode({ t: S2C.ERROR, code: 'room_idle', reason: room.expiryReason }));
            ws.close();
          } catch {
            /* already closing */
          }
        }
        sockets.clear();
        disposeRoom(code);
      }
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

/**
 * A real HTTP server that the WebSocket server attaches to.
 *
 * This used to be `new WebSocketServer({ port })`, which spins up an HTTP
 * server with NO request handler - so a plain GET (exactly what a
 * platform health check or startup probe sends) got no response at all
 * and hung until it timed out. On Cloud Run that reads as "the container
 * failed to start" with nothing useful in the logs.
 */
const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST, () => {
  console.log(`Munchie Mayhem server listening on ${HOST}:${PORT}`);
  console.log(`  health:    http://localhost:${PORT}/health`);
  console.log(`  websocket: ws://localhost:${PORT}`);
});

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
