import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions, resolveObstacleCollision } from '../sharedSteps.js';

/**
 * King of the Meal - classic king-of-the-hill. The crown starts on the
 * ground at a random spot (nobody starts as king; everyone races for it).
 * Whoever holds it scores continuously; touching the holder steals it
 * (with a brief transfer cooldown so it can't ping-pong between two
 * overlapping players in the same frame). No one is actually eliminated
 * in this minigame - it's decided purely by accumulated held-time, either
 * by reaching `targetHeldTime` early or having the most when the clock
 * runs out.
 *
 * The arena is scaled up (config.arenaScale) and filled with more
 * obstacles than other minigames, specifically so there's room to run and
 * break line of sight during a chase. As ChaosDirector's intensity rises,
 * the crown occasionally fumbles off the holder entirely at growing
 * force, flinging it to a new spot - so a runaway leader can't just turtle
 * in a corner forever once the pace ramps up.
 */
export class KingOfTheMeal extends MinigameBase {
  onStart() {
    this.obstacles = this.generateObstacles();
    for (const p of this.players) p.roundState.heldTime = 0;

    // "The crown starts random at the map and people will go after it" -
    // it begins on the ground, not on a player.
    this.crown = {
      holderId: null,
      dropped: true,
      // Starts already landed so the opening race is immediate.
      state: 'landed',
      x: this.rng.range(100, this.arena.width - 100),
      y: this.rng.range(100, this.arena.height - 100),
      radius: 16,
      altitude: 0,
      hoverProgress: 1,
      hoverDuration: 1,
      targetX: 0,
      targetY: 0,
    };
    // The initial spot is random, so it can land inside an obstacle just
    // like an ejected one can - settle it clear before play starts.
    this._settleCrown();
    this.transferCooldown = 0;
  }

  generateObstacles() {
    const { rng, arena, config } = this;
    const list = [];
    for (let i = 0; i < config.bigObstacleCount; i++) {
      list.push({ x: rng.range(80, arena.width - 80), y: rng.range(80, arena.height - 80), radius: config.bigObstacleRadius });
    }
    for (let i = 0; i < config.smallObstacleCount; i++) {
      list.push({ x: rng.range(60, arena.width - 60), y: rng.range(60, arena.height - 60), radius: config.smallObstacleRadius });
    }
    return list;
  }

  update(dt, inputs) {
    stepPlayersMovement(this.players, inputs, this.arena, dt, this.config.movement);
    for (const p of this.getAlivePlayers()) {
      for (const obs of this.obstacles) resolveObstacleCollision(p, obs, this.config.obstacleRestitution);
    }
    stepPlayerCollisions(this.players, this.config.playerRestitution);

    this.transferCooldown = Math.max(0, this.transferCooldown - dt);
    if (this.crown.dropped) this.updateDroppedCrown(dt);
    else this.updateHeldCrown(dt);
  }

  updateHeldCrown(dt) {
    const holder = this.players.find((p) => p.id === this.crown.holderId);
    if (!holder || !holder.alive) {
      this.ejectCrown(holder ?? { x: this.arena.width / 2, y: this.arena.height / 2 });
      return;
    }
    holder.roundState.heldTime += dt;
    this.crown.x = holder.x;
    this.crown.y = holder.y - holder.radius - 14;

    if (this.transferCooldown <= 0) {
      for (const p of this.getAlivePlayers()) {
        if (p.id === holder.id) continue;
        const d = Math.hypot(p.x - holder.x, p.y - holder.y);
        if (d < p.radius + holder.radius) {
          // The crown does NOT go to whoever landed the touch - it pops
          // off and lands at a random spot a moderate distance away, and
          // everyone (including the ex-holder) races for it again.
          //
          // Handing it directly to the toucher was the old behaviour and
          // it made bots behave strangely: a bot would touch the holder,
          // instantly become the holder, immediately switch from "chase"
          // to "flee" while still overlapping the player it just touched,
          // get touched straight back, and the crown would ping-pong
          // between two overlapping players. Ejecting it breaks that loop
          // and turns every steal into a fresh scramble, which is the
          // whole point of the minigame.
          this.ejectCrown(holder);
          this.bus?.emit?.('crown:stolen', { from: holder.id, by: p.id });
          break;
        }
      }
    }

    // As the pace ramps up, the crown occasionally fumbles off on its
    // own - both the chance and the launch force scale with chaos
    // intensity, exactly the "expelled with more force once the game is
    // more rapid" behaviour from the brief.
    const fumbleChance = this.config.fumbleChancePerSecond * this.chaos.intensity * dt;
    if (this.rng.chance(fumbleChance)) {
      this.ejectCrown(holder, this.chaos.intensity);
    }
  }

  /**
   * Pops the crown off to a random spot a moderate distance from where it
   * was lost, and leaves it unheld so everyone races for it.
   *
   * Distance is a fraction of the map's smaller dimension (config
   * `ejectDistanceMin`/`ejectDistanceMax`, defaulting to 1/4 - 1/3). Using
   * the SMALLER dimension keeps the throw sensible on any arena shape -
   * on a tall portrait phone arena, a fraction of the height could
   * otherwise launch the crown clean across the playable width.
   *
   * The chosen angle is retried a few times to find a landing spot inside
   * the arena; failing that it's clamped. Retrying rather than clamping
   * immediately matters because clamping a bad angle would bias landings
   * toward the arena edges, and a crown that keeps landing in corners is
   * both predictable and boring to chase.
   *
   * `forceScale` (>1 as the round heats up) stretches the distance, so a
   * fumble late in a fast round throws the crown further - the "expelled
   * with more force once the game is more rapid" behaviour.
   */
  /**
   * True if a crown at (x,y) would be overlapping an obstacle.
   *
   * This is why the crown used to get stuck: ejectCrown picked a landing
   * spot using only the arena bounds, so it could land inside a big
   * obstacle. Nothing then pushed it out, and since players collide with
   * obstacles they physically could not reach it - the round would stall
   * until the timer ran out. Landing spots are now tested against this,
   * and the drift step below also pushes the crown out if it ever ends up
   * inside one anyway.
   */
  _isBlocked(x, y) {
    for (const obs of this.obstacles) {
      if (Math.hypot(x - obs.x, y - obs.y) < obs.radius + this.crown.radius + 4) return true;
    }
    return false;
  }

  /**
   * Settles the crown into a legal position: clear of every obstacle AND
   * inside the arena.
   *
   * Iterative rather than one pass, because a single push-out can shove
   * the crown straight into a neighbouring obstacle, or past the wall
   * when obstacles cluster near an edge. (A regression test caught
   * exactly that - the crown ended up at y = -0.5, just outside the
   * arena.) Alternating push-then-clamp a few times resolves those
   * chains; if it still hasn't settled, we fall back to a deterministic
   * outward scan for any free spot, because leaving the crown embedded is
   * the one outcome that actually breaks the round.
   */
  _settleCrown() {
    const margin = this.crown.radius + 6;
    for (let pass = 0; pass < 4; pass++) {
      this._pushCrownOutOfObstacles();
      this.crown.x = Math.max(margin, Math.min(this.arena.width - margin, this.crown.x));
      this.crown.y = Math.max(margin, Math.min(this.arena.height - margin, this.crown.y));
      if (!this._isBlocked(this.crown.x, this.crown.y)) return;
    }

    // Still wedged: spiral outward from the current spot for a clear one.
    // Fixed iteration order, so this stays fully deterministic.
    for (let ring = 1; ring <= 10; ring++) {
      const r = ring * (this.crown.radius * 2.5);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const cx = Math.max(margin, Math.min(this.arena.width - margin, this.crown.x + Math.cos(a) * r));
        const cy = Math.max(margin, Math.min(this.arena.height - margin, this.crown.y + Math.sin(a) * r));
        if (!this._isBlocked(cx, cy)) {
          this.crown.x = cx;
          this.crown.y = cy;
          return;
        }
      }
    }
  }

  /** Pushes the crown out of any obstacle it's overlapping, along the
   * shortest path. Called repeatedly by _settleCrown. */
  _pushCrownOutOfObstacles() {
    for (const obs of this.obstacles) {
      const dx = this.crown.x - obs.x;
      const dy = this.crown.y - obs.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const minDist = obs.radius + this.crown.radius + 4;
      if (dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.crown.x = obs.x + nx * minDist;
        this.crown.y = obs.y + ny * minDist;
        // (The old drift-heading deflection lived here. A landed crown
        // doesn't move, so there's no heading left to deflect.)
      }
    }
  }

  /**
   * Sends the crown up and away like a UFO, to land somewhere distant.
   *
   * ── WHY THIS REPLACED THE CONSTANT FAST DRIFT ────────────────────────
   * The old loose crown drifted continuously at speed, right next to
   * whoever lost it. Three things went wrong with that:
   *   1. It was usually reachable immediately, so whoever happened to be
   *      adjacent often got it straight back - no real scramble.
   *   2. Bots dominated. A constantly-moving target rewards frame-perfect
   *      re-aiming, which a bot does every tick and a human cannot.
   *   3. Online it was uncatchable. A fast-moving pickup is the worst
   *      case for interpolation: you see it ~70ms behind where the server
   *      thinks it is, so you grab at empty space.
   *
   * The UFO model fixes all three. While HOVERING the crown is
   * untouchable, so there is nothing to mis-grab. It telegraphs its
   * landing spot the whole way (see the crownTarget drawable), so
   * everyone gets the same information at the same time and the race is
   * fair. Once LANDED it sits perfectly still, which makes it catchable
   * even with network interpolation - a stationary target has no lag
   * error.
   */
  ejectCrown(fromPos, forceScale = 1) {
    const target = this.pickLandingSpot(fromPos, forceScale);

    this.crown.state = 'hover';
    this.crown.dropped = true;
    this.crown.holderId = null;
    this.crown.fromX = fromPos.x;
    this.crown.fromY = fromPos.y;
    this.crown.targetX = target.x;
    this.crown.targetY = target.y;
    this.crown.x = fromPos.x;
    this.crown.y = fromPos.y;
    this.crown.hoverProgress = 0;

    const dist = Math.hypot(target.x - fromPos.x, target.y - fromPos.y);
    // Constant speed rather than constant duration, so a long throw takes
    // longer - it reads as actual travel rather than a teleport.
    this.crown.hoverDuration = Math.max(this.config.hoverMinDuration, dist / this.config.hoverSpeed);
    this.transferCooldown = 0;
  }

  /**
   * Chooses where the crown lands: far from whoever lost it, and as fair
   * as possible for everyone else.
   *
   * Scores candidate points by distance to the NEAREST player and takes
   * the best - so it lands in open space rather than in somebody's lap,
   * and the scramble starts from roughly equal footing. Candidates inside
   * obstacles are rejected outright (the old "crown stuck in an obstacle"
   * bug).
   */
  pickLandingSpot(fromPos, forceScale = 1) {
    const { rng, arena, config } = this;
    const minSide = Math.min(arena.width, arena.height);
    const minDist = minSide * config.landMinDistance * forceScale;
    const margin = this.crown.radius + 24;

    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < config.landCandidates; i++) {
      const x = rng.range(margin, arena.width - margin);
      const y = rng.range(margin, arena.height - margin);
      if (this._isBlocked(x, y)) continue;
      if (Math.hypot(x - fromPos.x, y - fromPos.y) < minDist) continue;

      let nearest = Infinity;
      for (const p of this.getAlivePlayers()) {
        nearest = Math.min(nearest, Math.hypot(x - p.x, y - p.y));
      }
      // Open space scores highest; a small random nudge stops repeated
      // ejects converging on the same "optimal" corner every time.
      const score = nearest + rng.range(0, 40);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }

    if (!best) {
      // Nothing qualified (crowded or tiny arena): settle at the centre.
      const saved = { x: this.crown.x, y: this.crown.y };
      this.crown.x = arena.width / 2;
      this.crown.y = arena.height / 2;
      this._settleCrown();
      best = { x: this.crown.x, y: this.crown.y };
      this.crown.x = saved.x;
      this.crown.y = saved.y;
    }
    return best;
  }

  /**
   * Advances a loose crown. Two states:
   *   hover  - in transit, UNTOUCHABLE, telegraphing its landing spot
   *   landed - sitting still, grabbable
   * See ejectCrown for why it works this way.
   */
  updateDroppedCrown(dt) {
    const crown = this.crown;

    if (crown.state === 'hover') {
      crown.hoverProgress = Math.min(1, crown.hoverProgress + dt / crown.hoverDuration);
      const t = crown.hoverProgress;
      // Ease out so it decelerates into the landing spot instead of
      // stopping dead - and that deceleration is the visual warning that
      // it is about to become grabbable.
      const eased = 1 - Math.pow(1 - t, 2);
      crown.x = crown.fromX + (crown.targetX - crown.fromX) * eased;
      crown.y = crown.fromY + (crown.targetY - crown.fromY) * eased;

      const dx = crown.targetX - crown.fromX;
      const dy = crown.targetY - crown.fromY;
      const len = Math.hypot(dx, dy) || 1;
      const wobble = Math.sin(t * Math.PI * 4) * this.config.hoverWobble * (1 - t);
      crown.x += (-dy / len) * wobble;
      crown.y += (dx / len) * wobble;
      // Altitude is purely for the renderer (height + ground shadow).
      crown.altitude = Math.sin(t * Math.PI) * this.config.hoverAltitude;

      if (t >= 1) {
        crown.state = 'landed';
        crown.altitude = 0;
        crown.x = crown.targetX;
        crown.y = crown.targetY;
        this._settleCrown();
      }
      // Untouchable in transit - deliberately no pickup check here.
      return;
    }

    // Landed: perfectly still, so it is catchable even through network
    // interpolation. Only now can anyone pick it up.
    if (this.transferCooldown > 0) return;
    for (const p of this.getAlivePlayers()) {
      const d = Math.hypot(p.x - this.crown.x, p.y - this.crown.y);
      if (d < p.radius + this.crown.radius) {
        this.crown.dropped = false;
        this.crown.state = 'held';
        this.crown.holderId = p.id;
        this.transferCooldown = this.config.transferCooldown;
        break;
      }
    }
  }

  getBotIntent(player) {
    if (this.crown.holderId === player.id) {
      let nearest = null;
      let best = Infinity;
      for (const p of this.getAlivePlayers()) {
        if (p.id === player.id) continue;
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        if (d < best) {
          best = d;
          nearest = p;
        }
      }
      return nearest ? { flee: nearest } : null;
    }
    if (this.crown.dropped) {
      // In transit the crown can't be grabbed, so head for where it will
      // land - exactly the information the on-screen marker gives humans.
      if (this.crown.state === 'hover') return { seek: { x: this.crown.targetX, y: this.crown.targetY } };
      return { seek: this.crown };
    }
    const holder = this.players.find((p) => p.id === this.crown.holderId);
    return holder ? { seek: holder } : null;
  }

  // Nobody dies in this minigame - it's decided by held-time, not survival.
  isFinished() {
    if (this.elapsed >= this.maxDuration) return true;
    return this.getAlivePlayers().some((p) => (p.roundState.heldTime ?? 0) >= this.config.targetHeldTime);
  }

  getResult() {
    const winner = this.players.reduce((best, p) => ((p.roundState.heldTime ?? 0) > (best?.roundState.heldTime ?? -1) ? p : best), null);
    return { winners: winner ? [winner.id] : [] };
  }

  getDrawables() {
    // Stable ids even though these never move: it keeps the invariant
    // "every blob drawable has an id" simple and machine-checkable.
    const list = this.obstacles.map((o, i) => ({ id: `obs_${i}`, type: 'blob', x: o.x, y: o.y, r: o.radius, fill: '#7fbf6a', face: false }));
    for (const p of this.getAlivePlayers()) {
      list.push({
        type: 'blob',
        id: p.id,
        characterId: p.characterId,
        x: p.x,
        y: p.y,
        r: p.radius,
        fill: p.color,
        face: true,
        crowned: this.crown.holderId === p.id,
        label: p.name,
        timerFrac: this.crown.holderId === p.id ? Math.min(1, (p.roundState.heldTime ?? 0) / this.config.targetHeldTime) : null,
      });
    }
    // While hovering, show the landing spot so everyone can commit to the
    // race with the same information at the same time.
    if (this.crown.state === 'hover') {
      list.push({
        id: 'crownTarget',
        type: 'crownTarget',
        x: this.crown.targetX,
        y: this.crown.targetY,
        r: this.crown.radius,
        progress: this.crown.hoverProgress,
      });
    }
    list.push({
      id: 'crown',
      type: 'crown',
      x: this.crown.x,
      y: this.crown.y,
      r: this.crown.radius,
      floating: this.crown.dropped,
      hovering: this.crown.state === 'hover',
      altitude: this.crown.altitude ?? 0,
    });
    return list;
  }
}
