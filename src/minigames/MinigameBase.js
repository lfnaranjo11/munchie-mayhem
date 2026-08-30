/**
 * MinigameBase.js - the contract every minigame implements. Read this file
 * first if you're adding a 6th minigame (see README.md "Adding a new
 * minigame" for the full walkthrough).
 *
 * A minigame subclass typically overrides:
 *   onStart()                 - place hazards/obstacles, initial state
 *   update(dt, inputs)        - one physics step; inputs is {playerId: {x,y}}
 *   getDrawables()            - declarative visuals for CanvasRenderer (never
 *                                touch canvas/DOM directly here)
 *   getBotIntent(player)      - optional; smarter-than-wander AI (see BotBrain.js)
 *   isFinished() / getResult()- optional; default is "last player standing,
 *                                or everyone still alive when time runs out"
 *
 * Every minigame receives the same constructor payload:
 *   players  shared array of player entities (persists across rounds)
 *   arena    {width, height} logical units (NOT canvas pixels - see
 *            CanvasRenderer/main.js for the pixel scaling)
 *   rng      a fresh RNG seeded per-round (see RNG.js)
 *   chaos    a fresh ChaosDirector for this round (see ChaosDirector.js)
 *   config   this minigame's fully-resolved config object (see configUtils.js)
 *   bus      the TournamentManager's EventBus, for optional analytics-style
 *            events like 'player:eliminated' - entirely optional to use
 */
export class MinigameBase {
  constructor({ players, arena, rng, chaos, config, bus }) {
    this.players = players;
    this.arena = arena;
    this.rng = rng;
    this.chaos = chaos;
    this.config = config;
    this.bus = bus;
    this.elapsed = 0;
    this.maxDuration = config.maxDuration ?? 120;
    this.backgroundColor = config.backgroundColor ?? '#fdeecb';

    // False until start() has run. A minigame is CONSTRUCTED (so the
    // instructions screen has something to show a title/icon for) well
    // before it's actually STARTED (once the players ready up) - onStart()
    // is where hazards/obstacles/etc. get initialized, so getDrawables()
    // and friends aren't safe to call until it has run. `started` is the
    // one flag callers (the render loop, in particular) should check
    // before asking a minigame for its current state. See start() below.
    this.started = false;
  }

  /**
   * TournamentManager calls this (not onStart() directly) once the round
   * actually begins. Wrapping onStart() this way guarantees `started`
   * always reflects reality with no risk of a caller forgetting to set it.
   */
  start() {
    this.onStart();
    this.started = true;
  }

  /** Called once, right when the round actually begins (after the instructions screen closes).
   * Override this, not start(), to set up a minigame's initial state. */
  onStart() {}

  /**
   * Called once per fixed physics tick by TournamentManager. Handles the
   * bookkeeping every minigame shares (elapsed time, feeding
   * ChaosDirector) then delegates to the subclass's update().
   */
  step(dt, inputs) {
    this.elapsed += dt;
    const aliveBefore = this.players.filter((p) => p.alive).length;
    this.update(dt, inputs);
    const aliveAfter = this.players.filter((p) => p.alive).length;
    this.chaos.update(dt, aliveAfter < aliveBefore);
  }

  /** Override in subclasses. `inputs` is {[playerId]: {x, y}}. */
  update(_dt, _inputs) {}

  getAlivePlayers() {
    return this.players.filter((p) => p.alive);
  }

  /** Default: round ends when at most one player is left, or time runs out. */
  isFinished() {
    return this.getAlivePlayers().length <= 1 || this.elapsed >= this.maxDuration;
  }

  /** Default: whoever's still alive (usually one, sometimes a tied field on timeout). */
  getResult() {
    return { winners: this.getAlivePlayers().map((p) => p.id) };
  }

  getTimeRemaining() {
    return Math.max(0, this.maxDuration - this.elapsed);
  }

  /** Override for minigame-specific bot behaviour; return null to fall back to wandering. */
  getBotIntent(_player) {
    return null;
  }

  /** Override to return declarative drawables for CanvasRenderer. */
  getDrawables() {
    return [];
  }
}
