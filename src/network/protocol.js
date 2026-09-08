/**
 * protocol.js - the wire format, shared verbatim by client and server.
 *
 * Deliberately ONE file imported by both sides. A protocol defined twice
 * is a protocol that drifts, and the resulting bugs look like netcode
 * bugs rather than the typos they are.
 *
 * JSON for v1: readable in devtools, trivial to debug, and small enough
 * at our entity counts (a 4-player snapshot is roughly 1-3 KB). If
 * bandwidth ever matters, swap encode/decode below for a binary codec -
 * nothing else needs to change, which is the point of routing everything
 * through these two functions.
 *
 * ── AUTHORITY MODEL ──────────────────────────────────────────────────
 * The server is authoritative: it runs the one true simulation and
 * broadcasts snapshots. Clients send only their input direction and
 * render what comes back. This is why the float-determinism caveat
 * (Math.sin/cos not being bit-identical across JS engines) doesn't apply
 * here - there is only ever one simulation, so there is nothing to
 * diverge. That was the deciding factor over lockstep.
 */

/** Bumped on any breaking wire change; the server refuses mismatches so a
 * stale cached client fails loudly instead of behaving strangely. */
export const PROTOCOL_VERSION = 1;

/** Client -> Server */
export const C2S = {
  JOIN: 'join',
  INPUT: 'input',
  READY: 'ready',
  LEAVE: 'leave',
  PING: 'ping',
};

/** Server -> Client */
export const S2C = {
  WELCOME: 'welcome', // you're in; here's your id and the roster
  LOBBY: 'lobby', // roster//status changed while waiting
  ROUND_START: 'roundStart', // show instructions, round begins shortly
  SNAPSHOT: 'snapshot', // authoritative world state
  ROUND_END: 'roundEnd',
  TOURNAMENT_END: 'tournamentEnd',
  ERROR: 'error',
  PONG: 'pong',
};

export const ERROR_CODES = {
  ROOM_FULL: 'room_full',
  ROOM_NOT_FOUND: 'room_not_found',
  VERSION_MISMATCH: 'version_mismatch',
  BAD_MESSAGE: 'bad_message',
};

/** Max humans per online room (bots fill the rest). */
export const MAX_PLAYERS = 4;

/** How often clients send input, and the server broadcasts snapshots.
 * Input at 20Hz keeps us far inside Cloudflare's 20:1 inbound message
 * billing; snapshots at 20Hz are interpolated client-side so the motion
 * still looks smooth at display rate. */
// 30Hz on both. Outbound messages are free on Cloudflare, so a higher
// snapshot rate costs nothing and halves the interpolation buffer we need.
// Inbound at 30Hz x 4 players is still only ~6 billed requests/sec under
// the 20:1 message ratio.
export const INPUT_HZ = 30;
export const SNAPSHOT_HZ = 30;
/** The authoritative simulation still steps at the same fixed rate the
 * offline game uses, so physics feel is identical online and off. */
export const SIM_HZ = 60;

export function encode(msg) {
  return JSON.stringify(msg);
}

/** @returns {object|null} null if the payload isn't valid JSON or isn't an object */
export function decode(raw) {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Room codes are short, unambiguous, and shareable out loud.
 * The alphabet omits 0/O/1/I/L so a code read over a call isn't
 * mistyped - a small thing that removes a whole class of "it says room
 * not found" support messages.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRoomCode(random = Math.random, length = 4) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalizes user-typed codes: uppercase, strip anything not in the alphabet. */
export function normalizeRoomCode(input) {
  return String(input || '')
    .toUpperCase()
    .split('')
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('');
}

/** Clamps an input vector to a unit disc. Applied server-side on every
 * received input: never trust a client not to send {x: 9999}. */
export function sanitizeInput(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  if (len > 1) return { x: x / len, y: y / len };
  return { x, y };
}
