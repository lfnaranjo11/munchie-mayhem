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
    const driftAngle = this.rng.range(0, Math.PI * 2);
    this.crown = {
      holderId: null,
      dropped: true,
      x: this.rng.range(100, this.arena.width - 100),
      y: this.rng.range(100, this.arena.height - 100),
      radius: 16,
      // Drift state - see updateDroppedCrown for what each does.
      dirX: Math.cos(driftAngle),
      dirY: Math.sin(driftAngle),
      driftTimer: this.rng.range(this.config.driftChangeMin, this.config.driftChangeMax),
      swayPhase: this.rng.range(0, Math.PI * 2),
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
        // Deflect the drift heading off the obstacle so it doesn't
        // immediately drift straight back in.
        const dot = this.crown.dirX * nx + this.crown.dirY * ny;
        if (dot < 0) {
          this.crown.dirX -= 2 * dot * nx;
          this.crown.dirY -= 2 * dot * ny;
        }
      }
    }
  }

  ejectCrown(fromPos, forceScale = 1) {
    const { rng, arena, config } = this;
    const minSide = Math.min(arena.width, arena.height);
    const distance = minSide * rng.range(config.ejectDistanceMin, config.ejectDistanceMax) * forceScale;

    let x = fromPos.x;
    let y = fromPos.y;
    const margin = this.crown.radius + 12;
    let found = false;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const candidateX = fromPos.x + Math.cos(angle) * distance;
      const candidateY = fromPos.y + Math.sin(angle) * distance;
      const inBounds =
        candidateX > margin &&
        candidateX < arena.width - margin &&
        candidateY > margin &&
        candidateY < arena.height - margin;
      // Must be in bounds AND clear of obstacles - the second check is
      // what stops the crown landing somewhere unreachable.
      if (inBounds && !this._isBlocked(candidateX, candidateY)) {
        x = candidateX;
        y = candidateY;
        found = true;
        break;
      }
    }

    if (!found) {
      // Fall back to a scan for any clear spot rather than dropping it
      // somewhere blocked. Deterministic order, so this stays reproducible.
      outer: for (let ring = 1; ring <= 6; ring++) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const r = distance * (ring / 6);
          const cx = Math.max(margin, Math.min(arena.width - margin, fromPos.x + Math.cos(a) * r));
          const cy = Math.max(margin, Math.min(arena.height - margin, fromPos.y + Math.sin(a) * r));
          if (!this._isBlocked(cx, cy)) {
            x = cx;
            y = cy;
            break outer;
          }
        }
      }
    }

    this.crown.dropped = true;
    this.crown.holderId = null;
    this.crown.x = x;
    this.crown.y = y;
    // Start drifting in a random heading (see updateDroppedCrown).
    const driftAngle = rng.range(0, Math.PI * 2);
    this.crown.dirX = Math.cos(driftAngle);
    this.crown.dirY = Math.sin(driftAngle);
    this.crown.driftTimer = rng.range(config.driftChangeMin, config.driftChangeMax);
    this.crown.swayPhase = rng.range(0, Math.PI * 2);
    this._settleCrown();
    this.transferCooldown = this.config.transferCooldown;
  }

  /**
   * The floating, feather-like drift of a loose crown.
   *
   * Design intent: the crown should be chaseable but never quite
   * predictable. It floats slowly along a heading with a sideways sway
   * (the "feather" part - a perpendicular sinusoid, so its path is a lazy
   * S rather than a straight line), and at random intervals it abruptly
   * picks a new heading. That sudden change is what stops players simply
   * running a straight intercept line: you have to keep adjusting.
   *
   * This lives in game logic rather than the render layer because it
   * changes the crown's actual position - it's gameplay, not decoration -
   * so it uses the seeded RNG and the fixed timestep, keeping the round
   * fully reproducible.
   */
  updateDroppedCrown(dt) {
    const { config } = this;
    const crown = this.crown;

    // Sudden direction change on a timer.
    crown.driftTimer -= dt;
    if (crown.driftTimer <= 0) {
      // Turn by a large random angle rather than picking a heading from
      // scratch, so the change reads as a sharp veer rather than a
      // teleport of intent.
      const turn = this.rng.range(config.driftTurnMin, config.driftTurnMax) * (this.rng.chance(0.5) ? 1 : -1);
      const current = Math.atan2(crown.dirY, crown.dirX);
      crown.dirX = Math.cos(current + turn);
      crown.dirY = Math.sin(current + turn);
      crown.driftTimer = this.rng.range(config.driftChangeMin, config.driftChangeMax);
    }

    // Feather sway: a perpendicular oscillation layered on the heading.
    crown.swayPhase += dt * config.driftSwaySpeed;
    const sway = Math.sin(crown.swayPhase) * config.driftSwayAmount;
    const perpX = -crown.dirY;
    const perpY = crown.dirX;

    // Drift speeds up as the round heats up, like everything else.
    const speed = config.driftSpeed * this.chaos.intensity;
    crown.x += (crown.dirX + perpX * sway) * speed * dt;
    crown.y += (crown.dirY + perpY * sway) * speed * dt;

    // Bounce off the arena edges so it never pins itself in a corner.
    const margin = crown.radius + 6;
    if (crown.x < margin) {
      crown.x = margin;
      crown.dirX = Math.abs(crown.dirX);
    } else if (crown.x > this.arena.width - margin) {
      crown.x = this.arena.width - margin;
      crown.dirX = -Math.abs(crown.dirX);
    }
    if (crown.y < margin) {
      crown.y = margin;
      crown.dirY = Math.abs(crown.dirY);
    } else if (crown.y > this.arena.height - margin) {
      crown.y = this.arena.height - margin;
      crown.dirY = -Math.abs(crown.dirY);
    }

    // Never let it come to rest inside an obstacle or outside the arena
    // (see _settleCrown - a naive single push can do both).
    this._settleCrown();

    if (this.transferCooldown > 0) return;
    for (const p of this.getAlivePlayers()) {
      const d = Math.hypot(p.x - this.crown.x, p.y - this.crown.y);
      if (d < p.radius + this.crown.radius) {
        this.crown.dropped = false;
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
    if (this.crown.dropped) return { seek: this.crown };
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
    const list = this.obstacles.map((o) => ({ type: 'blob', x: o.x, y: o.y, r: o.radius, fill: '#7fbf6a', face: false }));
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
    list.push({ id: 'crown', type: 'crown', x: this.crown.x, y: this.crown.y, r: this.crown.radius, floating: this.crown.dropped, dirX: this.crown.dirX, dirY: this.crown.dirY });
    return list;
  }
}
