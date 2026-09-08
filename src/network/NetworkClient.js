import { C2S, S2C, PROTOCOL_VERSION, INPUT_HZ, SNAPSHOT_HZ, encode, decode } from './protocol.js';
import { applyMomentumMovement } from '../core/PlayerController.js';

/** Beyond this much disagreement (px) we stop blending and just accept
 * the server's position - see updatePrediction. */
const PREDICTION_SNAP_DISTANCE = 90;
/** Fraction of the remaining error corrected per 60Hz frame. */
const PREDICTION_CORRECTION_RATE = 0.18;

/**
 * NetworkClient.js - the browser side of online play.
 *
 * Responsibilities, in order of how much they matter:
 *   1. Connect, join a room (by code or quick-match), stay connected.
 *   2. Send this player's input at a fixed rate (NOT once per frame - a
 *      144Hz display would otherwise send 7x more messages than a 60Hz
 *      one for identical play, and inbound messages are the thing we're
 *      billed for).
 *   3. Buffer incoming snapshots and expose an INTERPOLATED view of the
 *      world, which is what makes 20Hz server updates look smooth.
 *
 * ── WHY INTERPOLATE, AND WHY THE DELAY ───────────────────────────────
 * Snapshots arrive 20 times a second, unevenly (jitter). Rendering the
 * newest one directly gives visibly steppy motion. Instead we render the
 * world as it was `interpolationDelay` milliseconds ago, between the two
 * snapshots that bracket that moment. Costs a little latency; buys smooth
 * motion and immunity to a single late packet. This is the standard
 * approach and the reason online play looks fluid despite a slow update
 * rate.
 *
 * Local input is NOT predicted yet - your character responds after a
 * round trip. See the note in README ("Client-side prediction") for why
 * that's the deliberate next step rather than something done here.
 */
/**
 * Every drawable field that represents a position and must therefore be
 * blended between snapshots. Anything not listed is taken from the newer
 * snapshot as-is (colours, phases, flags - things that should switch
 * rather than blend).
 */
const INTERPOLATED_FIELDS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'r'];

export class NetworkClient {
  constructor({ url, onLobby, onRoundStart, onRoundEnd, onTournamentEnd, onError, onStatus }) {
    this.url = url;
    this.onLobby = onLobby;
    this.onRoundStart = onRoundStart;
    this.onRoundEnd = onRoundEnd;
    this.onTournamentEnd = onTournamentEnd;
    this.onError = onError;
    this.onStatus = onStatus;

    this.ws = null;
    this.connected = false;
    this.slot = null;
    this.roomCode = null;
    this.latency = null;

    /** Recent snapshots, oldest first, each stamped with local arrival time. */
    this.snapshots = [];
    // Two snapshot intervals of buffer: enough to ride out one late
    // packet, no more. At 30Hz that's ~66ms rather than the 100ms this
    // started at - on a LAN that buffer WAS the lag, not the network.
    this.interpolationDelay = (2 / SNAPSHOT_HZ) * 1000;
    this.maxBuffer = 20;

    this._inputTimer = null;
    this._pingTimer = null;
    this._latestInput = { x: 0, y: 0 };

    // ---- Client-side prediction --------------------------------------
    // Without this, your own character doesn't move until the server has
    // seen your input and a snapshot has come back - a full round trip
    // plus the interpolation buffer. Even on a LAN that reads as sluggish.
    // We simulate OUR OWN movement locally and immediately, then gently
    // correct toward the authoritative position.
    this.predictionEnabled = true;
    this.localPlayerId = null;
    this.movementCfg = null;
    this.arena = null;
    this.predicted = null;
  }

  connect({ roomCode, quick, name }) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.connected = true;
        this.onStatus?.('connected');
        ws.send(encode({ t: C2S.JOIN, v: PROTOCOL_VERSION, roomCode, quick: !!quick, name }));
        this._startTimers();
      });

      ws.addEventListener('message', (event) => {
        const msg = decode(event.data);
        if (!msg) return;
        this._handle(msg, resolve);
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        this._stopTimers();
        this.onStatus?.('disconnected');
      });

      ws.addEventListener('error', () => {
        // The close handler covers cleanup; surface a useful message
        // rather than the browser's opaque error event.
        reject(new Error(`Could not reach the game server at ${this.url}`));
      });
    });
  }

  _handle(msg, resolveJoin) {
    switch (msg.t) {
      case S2C.WELCOME:
        this.slot = msg.slot;
        this.roomCode = msg.roomCode;
        resolveJoin?.({ slot: msg.slot, roomCode: msg.roomCode });
        break;
      case S2C.LOBBY:
        this.onLobby?.(msg);
        break;
      case S2C.ROUND_START:
        // A new round means the old world is gone; stale snapshots would
        // otherwise interpolate across the transition and show players
        // sliding from the previous map's positions into the new one.
        this.snapshots.length = 0;
        this.onRoundStart?.(msg);
        break;
      case S2C.SNAPSHOT:
        this._pushSnapshot(msg);
        break;
      case S2C.ROUND_END:
        this.onRoundEnd?.(msg);
        break;
      case S2C.TOURNAMENT_END:
        this.onTournamentEnd?.(msg);
        break;
      case S2C.PONG:
        this.latency = Date.now() - msg.ts;
        break;
      case S2C.ERROR:
        this.onError?.(msg);
        break;
      default:
        break;
    }
  }

  _pushSnapshot(msg) {
    // Drop out-of-order arrivals: a late packet carrying an older seq
    // would rewind the interpolation and cause a visible stutter.
    const newest = this.snapshots[this.snapshots.length - 1];
    if (newest && msg.seq <= newest.seq) return;

    this.snapshots.push({ ...msg, at: performance.now() });
    while (this.snapshots.length > this.maxBuffer) this.snapshots.shift();
  }

  setInput(dir) {
    this._latestInput = dir;
  }

  /** Called on round start once we know which drawable is ours and what
   * movement tuning the server is using. */
  setLocalPlayer(playerId, movementCfg, arena) {
    this.localPlayerId = playerId;
    this.movementCfg = movementCfg;
    this.arena = arena;
    this.predicted = null; // re-seeded from the first snapshot
  }

  /**
   * Advances the local prediction one render frame and reconciles it with
   * the server.
   *
   * This is prediction WITHOUT rollback: we don't replay a history of
   * inputs against each authoritative snapshot. That's the textbook
   * approach, but it needs the client to reproduce server physics
   * exactly - including collisions with hazards and other players, which
   * we can't see coming. Instead we predict only free movement (which is
   * most of the time and all of what makes input feel responsive) and
   * blend toward the server whenever it disagrees. A collision therefore
   * resolves over a few frames rather than instantly, which reads as
   * slight softness on impact - a much better trade than laggy controls.
   *
   * @param {number} dt seconds since the last render frame
   * @param {{x:number,y:number}} input the direction being held right now
   * @param {{x:number,y:number}|null} serverPos authoritative position, if known
   */
  updatePrediction(dt, input, serverPos) {
    if (!this.predictionEnabled || !this.movementCfg) return null;

    if (!this.predicted) {
      if (!serverPos) return null;
      this.predicted = { x: serverPos.x, y: serverPos.y, vx: 0, vy: 0 };
      return this.predicted;
    }

    applyMomentumMovement(this.predicted, input, dt, this.movementCfg);

    if (this.arena) {
      this.predicted.x = Math.max(0, Math.min(this.arena.width, this.predicted.x));
      this.predicted.y = Math.max(0, Math.min(this.arena.height, this.predicted.y));
    }

    if (serverPos) {
      const errX = serverPos.x - this.predicted.x;
      const errY = serverPos.y - this.predicted.y;
      const error = Math.hypot(errX, errY);

      if (error > PREDICTION_SNAP_DISTANCE) {
        // Way off - we missed something big (a bounce, an elimination,
        // a respawn). Blending over that distance would look like the
        // character swimming across the map, so take the server's word.
        this.predicted.x = serverPos.x;
        this.predicted.y = serverPos.y;
        this.predicted.vx = 0;
        this.predicted.vy = 0;
      } else {
        // Small disagreement - ease toward truth. Frame-rate independent
        // so the correction feels the same at 60 and 144Hz.
        const t = 1 - Math.pow(1 - PREDICTION_CORRECTION_RATE, dt * 60);
        this.predicted.x += errX * t;
        this.predicted.y += errY * t;
      }
    }
    return this.predicted;
  }

  sendReady() {
    this._send({ t: C2S.READY });
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  _startTimers() {
    this._stopTimers();
    // Fixed-rate input, decoupled from frame rate (see class header).
    this._inputTimer = setInterval(() => {
      this._send({ t: C2S.INPUT, d: this._latestInput });
    }, 1000 / INPUT_HZ);
    this._pingTimer = setInterval(() => this._send({ t: C2S.PING, ts: Date.now() }), 2000);
  }

  _stopTimers() {
    clearInterval(this._inputTimer);
    clearInterval(this._pingTimer);
    this._inputTimer = null;
    this._pingTimer = null;
  }

  /**
   * The world as it should be drawn right now: the two snapshots
   * bracketing (now - interpolationDelay), blended together.
   *
   * @returns {{drawables: Array, bg: string, time: number, scores: Array}|null}
   */
  getInterpolatedState() {
    if (this.snapshots.length === 0) return null;
    if (this.snapshots.length === 1) return this._asState(this.snapshots[0]);

    const renderTime = performance.now() - this.interpolationDelay;

    let older = null;
    let newer = null;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].at <= renderTime) {
        older = this.snapshots[i];
        newer = this.snapshots[i + 1] ?? null;
        break;
      }
    }

    // Running ahead of the buffer (a stall, or we just joined): show the
    // oldest we have rather than nothing, so the screen never goes blank.
    if (!older) return this._asState(this.snapshots[0]);
    if (!newer) return this._asState(older);

    const span = newer.at - older.at;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTime - older.at) / span)) : 0;
    return this._asState(older, newer, alpha);
  }

  /**
   * Blends two snapshots. Drawables are matched by `id`; anything without
   * one (particles, static scenery) is taken from the newer snapshot as-is.
   *
   * Velocity is derived here from the position delta rather than being
   * sent over the wire - the animation layer needs vx/vy for squash and
   * dust, and we already have both endpoints in hand.
   */
  _asState(a, b, alpha = 0) {
    if (!b) {
      return { drawables: a.d.map((d) => ({ ...d, vx: 0, vy: 0 })), bg: a.bg, time: a.time, scores: a.scores };
    }

    const byId = new Map();
    for (const d of a.d) if (d.id) byId.set(d.id, d);

    const dtSeconds = Math.max((b.at - a.at) / 1000, 1e-3);
    const drawables = b.d.map((d) => {
      const prev = d.id ? byId.get(d.id) : null;
      if (!prev) return { ...d, vx: 0, vy: 0 };

      const out = { ...d, vx: 0, vy: 0 };
      // Interpolate EVERY positional field, not just x/y. The laser beam
      // is drawn from x1,y1 to x2,y2 - interpolating only x/y left it
      // snapping between server ticks while everything around it moved
      // smoothly. Same class of bug as a drawable having no id at all.
      for (const key of INTERPOLATED_FIELDS) {
        if (typeof d[key] === 'number' && typeof prev[key] === 'number') {
          out[key] = prev[key] + (d[key] - prev[key]) * alpha;
        }
      }
      if (typeof d.x === 'number' && typeof prev.x === 'number') {
        out.vx = (d.x - prev.x) / dtSeconds;
        out.vy = (d.y - prev.y) / dtSeconds;
      }
      return out;
    });

    return { drawables, bg: b.bg, time: b.time, scores: b.scores };
  }

  disconnect() {
    this._stopTimers();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
