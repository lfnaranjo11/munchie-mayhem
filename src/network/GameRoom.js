import { TournamentManager } from '../tournament/TournamentManager.js';
import { MINIGAME_REGISTRY } from '../minigames/registry.js';
import { GLOBAL_DEFAULTS } from '../../config/global.config.js';
import { S2C, SNAPSHOT_HZ, SIM_HZ, MAX_PLAYERS, sanitizeInput } from './protocol.js';

/**
 * GameRoom.js - one authoritative online match.
 *
 * ── TRANSPORT-AGNOSTIC ON PURPOSE ────────────────────────────────────
 * This class never touches a WebSocket. It's handed a `send(connId, msg)`
 * and a `broadcast(msg)` callback and calls `tick(dt)` when driven. Two
 * adapters wrap it:
 *   server/cloudflare/  - a Durable Object (one DO instance per room)
 *   server/node-server.mjs - plain Node + ws, for local dev and any VPS
 * Same room logic in both, so switching hosting is a deployment decision
 * rather than a rewrite - and local testing exercises the real code path
 * rather than a stand-in.
 *
 * ── WHY THE SNAPSHOT IS JUST DRAWABLES ───────────────────────────────
 * Minigames already expose their whole visible state as a flat list of
 * plain drawable descriptors (see MinigameBase.getDrawables). That list
 * IS the snapshot - no separate network serialization layer to write and
 * keep in sync with the rules. Clients become near-pure renderers, and
 * any new minigame is automatically network-ready with no extra work.
 *
 * Velocity isn't sent: the client derives it by differencing consecutive
 * snapshots, which it must buffer for interpolation anyway. That keeps
 * the payload smaller and means the animation layer needs nothing extra.
 */

/** Every empty seat becomes a bot, so a 2-player room still plays as a
 * full 4-way match. (This used to fill only up to 2 total players, which
 * meant two humans got NO bots at all - directly contradicting the
 * "empty seats are filled with bots" promise in the lobby UI.) */
const TARGET_TOTAL_PLAYERS = MAX_PLAYERS;

/**
 * Pacing between rounds. These were 5s and 4s, which with the client's
 * own results delay added up to ~9 seconds of staring at overlays between
 * every single round - the "a lot of overhead before starting every
 * level" problem. Party games live on momentum; keep these tight.
 */
const INSTRUCTION_SECONDS = 2.5;
const ROUND_END_SECONDS = 2.5;

/**
 * If a player's input goes quiet for this long, a bot takes the wheel so
 * the match doesn't stall around a frozen character. Control is handed
 * straight back the moment their input resumes - this is a lag/AFK
 * cushion, not a kick. 3s is comfortably longer than any normal network
 * hiccup at a 30Hz input rate (which is a packet every 33ms).
 */
const LAG_TAKEOVER_SECONDS = 3;

/** How long the champion screen shows before the room returns to the
 * lobby for a rematch. Without this the room was simply stuck in
 * 'finished' forever and everyone had to reload. */
const REMATCH_SECONDS = 8;

/**
 * How long a room may sit in the lobby with nobody ready before the
 * server closes it.
 *
 * THIS IS A COST CONTROL, not a gameplay rule. An open WebSocket keeps a
 * serverless instance alive and billing - so a browser tab left open on
 * the lobby overnight quietly bills for the whole night at the
 * always-allocated CPU rate. Nothing in the game needs an idle lobby to
 * persist, so we hang up on it.
 */
const IDLE_LOBBY_SECONDS = 10 * 60;

/**
 * Backstop for a match where every human has gone silent (all taken over
 * by bots). Without this, four abandoned tabs would play bot-vs-bot
 * forever on your bill.
 */
const ALL_IDLE_MATCH_SECONDS = 3 * 60;

export class GameRoom {
  /**
   * @param {object} opts
   * @param {string} opts.code room code
   * @param {(connId: string, msg: object) => void} opts.send
   * @param {(msg: object) => void} opts.broadcast
   * @param {number} [opts.targetScore]
   * @param {number} [opts.seed]
   */
  constructor({ code, send, broadcast, targetScore = 3, seed }) {
    this.code = code;
    this.send = send;
    this.broadcast = broadcast;
    this.targetScore = targetScore;
    this.seed = seed ?? Date.now();

    /** connId -> { connId, name, slot, ready } */
    this.connections = new Map();
    /** slot -> {x,y}; the latest input each seat has sent. */
    this.inputs = new Map();

    this.tournament = null;
    this.phase = 'lobby'; // lobby | instructions | playing | roundEnd | finished
    this.snapshotAccumulator = 0;
    this.instructionTimer = 0;
    this.roundEndTimer = 0;
    this.rematchTimer = 0;
    this.seq = 0;
    /** Monotonic room clock in seconds, advanced by tick(). Used for lag
     * detection - deliberately not wall-clock, so it can't jump. */
    this.clock = 0;
    /** slot -> room-clock time of that seat's last input. */
    this.lastInputAt = new Map();
    /** Set when the room decides it should be torn down; the transport
     * adapter polls this and closes the sockets. */
    this.expired = false;
    this.expiryReason = null;
    this.idleSeconds = 0;
  }

  get playerCount() {
    return this.connections.size;
  }

  isFull() {
    return this.connections.size >= MAX_PLAYERS;
  }

  isJoinable() {
    // Public quick-match only ever routes people into rooms still in the
    // lobby; dropping someone into round 3 of a stranger's tournament is
    // a bad first impression.
    return !this.isFull() && this.phase === 'lobby';
  }

  // ---- Connection lifecycle --------------------------------------------

  addPlayer(connId, name) {
    if (this.isFull()) return { ok: false, reason: 'room_full' };
    // Reuse the lowest free slot so leaving and rejoining doesn't create
    // gaps that would strand a player's inputs on a dead seat.
    const used = new Set([...this.connections.values()].map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;

    // Trim and bound the display name; fall back to a seat label. Names
    // are echoed to every client, so never trust the length.
    const cleanName = String(name || '').trim().slice(0, 12) || `Player ${slot + 1}`;
    this.connections.set(connId, { connId, name: cleanName, slot, ready: false, takenOver: false });
    this.inputs.set(slot, { x: 0, y: 0 });
    this.lastInputAt.set(slot, this.clock);

    this.send(connId, {
      t: S2C.WELCOME,
      connId,
      slot,
      roomCode: this.code,
      maxPlayers: MAX_PLAYERS,
    });
    this.broadcastLobby();
    return { ok: true, slot };
  }

  removePlayer(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    this.connections.delete(connId);
    this.inputs.delete(conn.slot);

    if (this.connections.size === 0) {
      // Nobody left - stop simulating. The adapter is responsible for
      // disposing the room; this just makes sure we're not burning CPU
      // (and, on Cloudflare, billable duration) on an empty match.
      this.phase = 'lobby';
      this.tournament = null;
      return;
    }
    // A player leaving mid-round leaves their character standing there,
    // so hand the seat to a bot rather than a statue.
    if (this.tournament) {
      const player = this.tournament.players.find((p) => p.inputSlot === conn.slot);
      if (player) {
        player.isBot = true;
        player.inputSlot = null;
      }
    }
    this.broadcastLobby();
  }

  handleMessage(connId, msg) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    // Any real message counts as activity. Pings alone deliberately do
    // NOT reset the lobby idle timer (see below) - a forgotten tab keeps
    // pinging happily.
    if (msg.t !== 'ping') this.idleSeconds = 0;

    switch (msg.t) {
      case 'input':
        // Always sanitized - a client could send anything.
        this.inputs.set(conn.slot, sanitizeInput(msg.d));
        this.lastInputAt.set(conn.slot, this.clock);
        // Input is proof of life: if a bot had taken over during a lag
        // spike, give control straight back.
        if (conn.takenOver) this.restoreControl(conn);
        break;
      case 'ready':
        conn.ready = true;
        this.broadcastLobby();
        if (this.phase === 'lobby' && this.allReady()) this.startTournament();
        break;
      case 'ping':
        // Echo the client's timestamp so it can measure round-trip time
        // without the server needing a synchronized clock.
        this.send(connId, { t: S2C.PONG, ts: msg.ts });
        break;
      default:
        break;
    }
  }

  allReady() {
    if (this.connections.size === 0) return false;
    return [...this.connections.values()].every((c) => c.ready);
  }

  broadcastLobby() {
    this.broadcast({
      t: S2C.LOBBY,
      phase: this.phase,
      players: [...this.connections.values()].map((c) => ({ slot: c.slot, name: c.name, ready: c.ready })),
      maxPlayers: MAX_PLAYERS,
    });
  }

  // ---- Match flow --------------------------------------------------------

  startTournament() {
    const humanCount = this.connections.size;
    // Fill every remaining seat with a bot.
    const botCount = Math.max(0, TARGET_TOTAL_PLAYERS - humanCount);

    this.tournament = new TournamentManager({
      targetScore: this.targetScore,
      humanPlayers: humanCount,
      botCount,
      enabledMinigames: Object.keys(MINIGAME_REGISTRY),
      seed: this.seed,
      globalConfig: GLOBAL_DEFAULTS,
    });

    // Map network seats onto the tournament's human player slots.
    const slots = [...this.connections.values()].map((c) => c.slot).sort((a, b) => a - b);
    this.tournament.players
      .filter((p) => !p.isBot)
      .forEach((p, i) => {
        p.inputSlot = slots[i] ?? null;
      });

    // Apply the names people actually typed. TournamentManager creates
    // generic "Player 1/2/3" labels; without this the name field in the
    // lobby was collected, shown in the lobby list, and then silently
    // ignored for the entire match.
    for (const conn of this.connections.values()) {
      const player = this.tournament.players.find((p) => p.inputSlot === conn.slot);
      if (player) player.name = conn.name;
    }

    this.tournament.on('round:end', (payload) => {
      this.phase = 'roundEnd';
      this.roundEndTimer = ROUND_END_SECONDS;
      this.broadcast({
        t: S2C.ROUND_END,
        // The client uses this to time its results overlay so it clears
        // before the next round begins, instead of guessing.
        roundSeconds: ROUND_END_SECONDS,
        winners: payload.result.winners,
        roundIndex: payload.roundIndex,
        standings: this.tournament.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
      });
    });

    this.tournament.on('tournament:end', (champion) => {
      this.phase = 'finished';
      this.rematchTimer = REMATCH_SECONDS;
      this.broadcast({
        t: S2C.TOURNAMENT_END,
        championId: champion.id,
        championName: champion.name,
        // Tell clients when the room returns to the lobby so they can
        // show a countdown instead of appearing frozen on the win screen.
        lobbyInSeconds: REMATCH_SECONDS,
        standings: this.tournament.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
          characterId: p.characterId,
        })),
      });
    });

    this.beginRound();
  }

  beginRound() {
    this.tournament.startNextRound();
    const mg = this.tournament.currentMinigame;
    this.phase = 'instructions';
    // Fixed instruction window rather than waiting on every client to
    // confirm: online, one AFK player shouldn't be able to stall three
    // others indefinitely.
    this.instructionTimer = INSTRUCTION_SECONDS;

    this.broadcast({
      t: S2C.ROUND_START,
      minigameId: mg.meta.id,
      title: mg.meta.title,
      icon: mg.meta.icon,
      instructions: mg.meta.instructions,
      startsIn: this.instructionTimer,
      arena: { width: mg.arena.width, height: mg.arena.height },
      // The client needs these to predict its own movement locally (see
      // NetworkClient prediction) - it must use the exact same tuning the
      // server simulates with, or prediction fights the authority.
      movement: mg.config.movement,
      roundSeconds: ROUND_END_SECONDS,
      players: this.tournament.players.map((p) => ({
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        inputSlot: p.inputSlot,
        isBot: p.isBot,
      })),
    });
  }

  /**
   * Hands a lagging/AFK seat to a bot. The player keeps their slot and
   * identity - only `isBot` flips, so TournamentManager starts asking
   * BotBrain for their input instead of the network. Reversible.
   */
  takeOverWithBot(conn) {
    const player = this.tournament?.players.find((p) => p.inputSlot === conn.slot);
    if (!player || player.isBot) return;
    player.isBot = true;
    conn.takenOver = true;
    this.broadcast({ t: S2C.PLAYER_STATUS, slot: conn.slot, name: conn.name, takenOver: true });
  }

  restoreControl(conn) {
    const player = this.tournament?.players.find((p) => p.inputSlot === conn.slot);
    conn.takenOver = false;
    if (player) player.isBot = false;
    this.broadcast({ t: S2C.PLAYER_STATUS, slot: conn.slot, name: conn.name, takenOver: false });
  }

  /** Returns the room to the lobby so everyone can rematch without
   * reloading the page. */
  resetToLobby() {
    this.phase = 'lobby';
    this.tournament = null;
    for (const conn of this.connections.values()) {
      conn.ready = false;
      conn.takenOver = false;
    }
    this.broadcastLobby();
  }

  /** Input source shaped like InputManager, reading the latest network
   * input per seat - so TournamentManager needs no online-specific code. */
  makeInputSource() {
    return {
      getDirection: (slot) => this.inputs.get(slot) ?? { x: 0, y: 0 },
      isReadyPressed: () => false,
    };
  }

  // ---- The authoritative loop -------------------------------------------

  /**
   * Advances the room by `dt` seconds. Adapters call this on a timer.
   * Simulation runs at the same fixed step as the offline game so that
   * physics feel is identical; snapshots go out at a lower rate and are
   * interpolated client-side.
   */
  tick(dt) {
    this.clock += dt;
    this.updateIdleShutdown(dt);
    if (this.expired) return;

    if (this.phase === 'finished') {
      // Hold on the champion screen, then hand the room back to the lobby.
      this.rematchTimer -= dt;
      if (this.rematchTimer <= 0) this.resetToLobby();
      return;
    }

    if (this.phase === 'instructions') {
      this.instructionTimer -= dt;
      if (this.instructionTimer <= 0) {
        this.phase = 'playing';
        this.tournament.beginRound();
      }
      return;
    }

    if (this.phase === 'roundEnd') {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= 0 && this.tournament.phase !== 'finished') this.beginRound();
      return;
    }

    if (this.phase !== 'playing' || !this.tournament) return;

    // Lag/AFK sweep: hand quiet seats to a bot so nobody is stuck playing
    // around a statue, and take them back as soon as input returns.
    for (const conn of this.connections.values()) {
      const quietFor = this.clock - (this.lastInputAt.get(conn.slot) ?? this.clock);
      if (!conn.takenOver && quietFor > LAG_TAKEOVER_SECONDS) this.takeOverWithBot(conn);
    }

    const inputSource = this.makeInputSource();
    const inputs = this.tournament.collectInputs(inputSource);
    this.tournament.update(dt, inputs);

    this.snapshotAccumulator += dt;
    const interval = 1 / SNAPSHOT_HZ;
    if (this.snapshotAccumulator >= interval) {
      this.snapshotAccumulator %= interval;
      this.broadcastSnapshot();
    }
  }

  /**
   * Decides whether this room is wasting money and should be closed.
   * Two cases: an abandoned lobby, and a match where every human has gone
   * quiet. Both are cost controls - see the constants at the top.
   */
  updateIdleShutdown(dt) {
    if (this.expired) return;

    if (this.phase === 'lobby') {
      const anyoneReady = [...this.connections.values()].some((c) => c.ready);
      // An empty or unready lobby ages; any activity resets it.
      if (!anyoneReady) {
        this.idleSeconds += dt;
        if (this.idleSeconds > IDLE_LOBBY_SECONDS) {
          this.expired = true;
          this.expiryReason = 'idle_lobby';
        }
      } else {
        this.idleSeconds = 0;
      }
      return;
    }

    if (this.phase === 'playing') {
      // Every human taken over by a bot means nobody is actually here.
      const humans = [...this.connections.values()];
      const allTakenOver = humans.length > 0 && humans.every((c) => c.takenOver);
      if (allTakenOver) {
        this.idleSeconds += dt;
        if (this.idleSeconds > ALL_IDLE_MATCH_SECONDS) {
          this.expired = true;
          this.expiryReason = 'all_players_idle';
        }
      } else {
        this.idleSeconds = 0;
      }
    }
  }

  broadcastSnapshot() {
    const mg = this.tournament?.currentMinigame;
    if (!mg?.started) return;
    this.broadcast({
      t: S2C.SNAPSHOT,
      seq: this.seq++,
      // The drawable list IS the world state - see the file header.
      d: mg.getDrawables(),
      bg: mg.backgroundColor,
      time: Math.round(mg.getTimeRemaining?.() ?? 0),
      scores: this.tournament.players.map((p) => ({ id: p.id, score: p.score, alive: p.alive })),
    });
  }
}

export { SIM_HZ, SNAPSHOT_HZ };
