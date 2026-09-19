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
  PLAYER_STATUS: 'playerStatus', // someone was taken over by a bot, or came back
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

/** Display names are the player's own, not an identifier - so the rules
 * are deliberately permissive. Accents, spaces, emoji and non-Latin
 * scripts are all fine; the only limits are the two that actually
 * matter. */
export const MAX_NAME_LENGTH = 20;

/**
 * Cleans a display name and explains any change.
 *
 * Only two things are enforced, and both have a real reason:
 *   - length, so a name still fits above a character on a phone screen
 *   - invisible characters (control codes, zero-width, bidi overrides),
 *     which can be used to spoof or break the layout of everyone else's
 *     lobby list
 * Everything else the player typed is kept as-is. Room CODES are
 * restricted (they get read aloud and mistyped); names are not, and
 * conflating the two was a mistake.
 *
 * @returns {{name: string, note: string|null}} note explains any change
 */
export function sanitizeName(raw) {
  const original = String(raw ?? '');
  // Strip control chars, zero-width joiners/spaces and bidi overrides.
  let name = original.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, '');
  name = name.replace(/\s+/g, ' ').trim();

  let note = null;
  if (name !== original.replace(/\s+/g, ' ').trim()) {
    note = 'Invisible characters were removed.';
  }
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH).trim();
    note = `Names are capped at ${MAX_NAME_LENGTH} characters so they fit on screen.`;
  }
  return { name, note };
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
