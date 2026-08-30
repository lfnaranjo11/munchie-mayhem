/**
 * InputSource.js - the seam where real internet multiplayer plugs in.
 * This file is intentionally NOT wired into the game yet - see the "why
 * not now" note at the bottom, and README.md's "Online multiplayer"
 * section for the full picture and next steps.
 *
 * ── THE CONTRACT ──────────────────────────────────────────────────────
 * Every input source in this game - InputManager (keyboard) and BotBrain
 * (AI) today, a NetworkInputSource tomorrow - produces the exact same
 * shape for a given player: { x: number, y: number }, a roughly-normalized
 * direction vector. TournamentManager.collectInputs() is the only place
 * that asks "is this player a bot or local human" and picks a source;
 * every minigame's update(dt, inputs) just receives a plain
 * {playerId: {x,y}} map and has never heard of keyboards, AI, or sockets.
 * That separation is what makes adding a network source additive rather
 * than a rewrite.
 *
 * ── WHY THIS AVOIDS THE "BUGGY, RACE-CONDITIONED STATE MESS" ──────────
 * The classic way networked multiplayer goes wrong (and, going by the
 * brief, the way it went wrong last time) is sending STATE across the
 * wire - "player A is now at (412, 88)" - from multiple clients that each
 * think they're authoritative. Two clients' physics steps interleave in
 * whatever order packets happen to arrive, so they silently drift apart,
 * and "fixing" it usually means bolting on more special-case
 * reconciliation code until it's unmaintainable.
 *
 * This engine is built to sidestep that entirely via LOCKSTEP netcode,
 * the same technique classic RTS games and modern rollback fighting
 * games use:
 *
 *   - The simulation is fully DETERMINISTIC: fixed timestep (GameLoop.js),
 *     seeded RNG only (RNG.js - never Math.random()), and no reliance on
 *     wall-clock time inside game logic.
 *   - That means: same starting seed + same sequence of inputs applied in
 *     the same order = bit-for-bit the same outcome, on any machine.
 *   - So clients never need to send STATE at all. Each client only sends
 *     its own player's {x,y} input for the current simulated tick. Every
 *     client collects both players' inputs for tick N, THEN simulates
 *     tick N locally, using the exact same collectInputs()/update() path
 *     already used for local bots. There is nothing to reconcile because
 *     both sides compute the same answer from the same facts.
 *
 * The real remaining work for online play is transport plumbing, not
 * state-sync logic:
 *   1. A tiny relay (a WebSocket server that just timestamps and
 *      rebroadcasts each player's input packets to the others - it does
 *      not need to run any game logic itself) or a peer-to-peer channel
 *      (e.g. PeerJS/WebRTC data channels) for LAN-free P2P.
 *   2. A NetworkInputSource here that buffers incoming remote inputs by
 *      tick number and exposes them with the same getDirection(slot)
 *      shape InputManager uses, so TournamentManager.collectInputs()
 *      barely changes.
 *   3. A small input-delay buffer (simulate tick N a few ticks after it
 *      was issued, e.g. 3-5 ticks at 60Hz) to absorb normal network
 *      jitter without stalling - standard practice, not a hack.
 *   4. A disconnect/pause policy (what happens if a packet is late - wait
 *      a bounded amount, or drop the peer to a bot) so a bad connection
 *      degrades instead of freezing the game.
 *
 * ── WHY THIS ISN'T WIRED UP IN THIS PASS ────────────────────────────
 * The brief explicitly leaves this call to be made here, flags "don't
 * sacrifice playability for this," and mentions a rough experience with
 * exactly this kind of bug before. A relay/transport layer can't be
 * meaningfully tested without a second real client and a second network
 * peer, which isn't something that can be verified from here - shipping
 * that untested would risk introducing the very bugginess this design is
 * meant to avoid. Local 2-player (same device) and 1-player-plus-bot are
 * fully implemented and solid today, which already satisfies "at least 2
 * players, my choice on internet." When you're ready to add real
 * networking, this file plus the README section are the starting point.
 */
export class NetworkInputSourceStub {
  constructor() {
    throw new Error(
      'NetworkInputSourceStub is a placeholder, not implemented yet. ' +
        'See the file header here and README.md "Online multiplayer" for the plan.'
    );
  }
}
