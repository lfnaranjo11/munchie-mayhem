/**
 * server/cloudflare/worker.js - Cloudflare adapter.
 *
 * Routing:
 *   GET /join?code=ABCD   -> WebSocket into that room (creates if absent)
 *   GET /join?quick=1     -> WebSocket into any joinable public room
 *
 * ── WHY DURABLE OBJECTS ──────────────────────────────────────────────
 * A game room is inherently stateful and single-threaded: one simulation,
 * one set of connected sockets, strongly consistent. That is exactly what
 * a Durable Object is. One DO instance per room code means rooms are
 * isolated by construction, scale to zero when empty (no idle cost), and
 * need no external database for match state.
 *
 * The Matchmaker is a single well-known DO holding the list of joinable
 * public rooms for quick-match.
 */
import { GameRoom } from '../../src/network/GameRoom.js';
import { SIM_HZ, S2C, ERROR_CODES, PROTOCOL_VERSION, decode, encode, generateRoomCode, normalizeRoomCode } from '../../src/network/protocol.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    if (url.pathname !== '/join') {
      return new Response('Not found', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    let code = normalizeRoomCode(url.searchParams.get('code') || '');

    if (url.searchParams.get('quick') === '1' || !code) {
      // Ask the matchmaker for a room with space.
      const mmId = env.MATCHMAKER.idFromName('global');
      const mm = env.MATCHMAKER.get(mmId);
      const res = await mm.fetch('https://internal/allocate');
      code = (await res.text()).trim();
    }

    // Route to the Durable Object for this room code. idFromName makes
    // the mapping deterministic: the same code always reaches the same
    // instance, wherever the request enters the network.
    const id = env.GAME_ROOM.idFromName(code);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(new Request(`https://internal/ws?code=${code}`, request));
  },
};

/** One instance per room code. */
export class GameRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.room = null;
    this.sockets = new Map(); // connId -> WebSocket
    this.loop = null;
    this.lastTick = 0;
  }

  _ensureRoom(code) {
    if (this.room) return;
    this.room = new GameRoom({
      code,
      send: (connId, msg) => {
        const ws = this.sockets.get(connId);
        try {
          ws?.send(encode(msg));
        } catch {
          /* socket already closing */
        }
      },
      broadcast: (msg) => {
        const payload = encode(msg);
        for (const ws of this.sockets.values()) {
          try {
            ws.send(payload);
          } catch {
            /* socket already closing */
          }
        }
      },
    });
  }

  /**
   * The authoritative loop.
   *
   * NOTE: this uses setInterval while the DO is awake, which requires the
   * object to stay active - i.e. we deliberately do NOT use WebSocket
   * Hibernation for an in-progress match, because a hibernating object
   * cannot run a game loop. Hibernation would be the right choice for an
   * idle lobby; that's a worthwhile optimization later, but correctness
   * first. This is also the part of the Cloudflare adapter most worth
   * verifying under real load before relying on it.
   */
  _startLoop() {
    if (this.loop) return;
    this.lastTick = Date.now();
    this.loop = setInterval(() => {
      const now = Date.now();
      const dt = Math.min((now - this.lastTick) / 1000, 0.25);
      this.lastTick = now;
      try {
        this.room?.tick(dt);
      } catch (err) {
        console.error('tick failed', err);
      }
      if (this.sockets.size === 0) this._stopLoop();
    }, 1000 / SIM_HZ);
  }

  _stopLoop() {
    clearInterval(this.loop);
    this.loop = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = normalizeRoomCode(url.searchParams.get('code') || '') || generateRoomCode();
    this._ensureRoom(code);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const connId = crypto.randomUUID();

    server.addEventListener('message', (event) => {
      const msg = decode(event.data);
      if (!msg) return;

      if (msg.t === 'join') {
        if (msg.v !== PROTOCOL_VERSION) {
          server.send(encode({ t: S2C.ERROR, code: ERROR_CODES.VERSION_MISMATCH, expected: PROTOCOL_VERSION }));
          server.close();
          return;
        }
        // Register before addPlayer - it sends WELCOME synchronously via
        // room.send(), which resolves the socket by connId. (Same
        // ordering bug the Node adapter had; caught by test/network.mjs.)
        this.sockets.set(connId, server);
        const result = this.room.addPlayer(connId, msg.name);
        if (!result.ok) {
          this.sockets.delete(connId);
          server.send(encode({ t: S2C.ERROR, code: ERROR_CODES.ROOM_FULL }));
          server.close();
          return;
        }
        this._startLoop();
        this._reportToMatchmaker(code);
        return;
      }
      this.room.handleMessage(connId, msg);
    });

    const cleanup = () => {
      this.sockets.delete(connId);
      this.room?.removePlayer(connId);
      this._reportToMatchmaker(code);
      if (this.sockets.size === 0) this._stopLoop();
    };
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Keeps the quick-match index roughly current. Fire-and-forget: a
   * stale entry only costs one wasted allocation attempt, so this must
   * never block or fail a player's join. */
  _reportToMatchmaker(code) {
    try {
      const mmId = this.env.MATCHMAKER.idFromName('global');
      const mm = this.env.MATCHMAKER.get(mmId);
      const joinable = this.room?.isJoinable() ? '1' : '0';
      mm.fetch(`https://internal/report?code=${code}&joinable=${joinable}`).catch(() => {});
    } catch {
      /* matchmaker unavailable - room-code play still works */
    }
  }
}

/** Single global DO tracking which public rooms have space. */
export class MatchmakerDO {
  constructor(state) {
    this.state = state;
    this.joinable = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/report') {
      const code = url.searchParams.get('code');
      if (url.searchParams.get('joinable') === '1') this.joinable.add(code);
      else this.joinable.delete(code);
      return new Response('ok');
    }

    if (url.pathname === '/allocate') {
      const next = this.joinable.values().next();
      if (!next.done) return new Response(next.value);
      // Nothing open - mint a new code. It's added to the index once the
      // room reports itself, not optimistically here, so a code that
      // never gets used doesn't linger as a phantom open room.
      return new Response(generateRoomCode());
    }

    return new Response('Not found', { status: 404 });
  }
}
