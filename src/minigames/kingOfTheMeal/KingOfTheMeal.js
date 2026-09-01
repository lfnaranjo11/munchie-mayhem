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
      x: this.rng.range(100, this.arena.width - 100),
      y: this.rng.range(100, this.arena.height - 100),
      vx: 0,
      vy: 0,
      radius: 16,
    };
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
  ejectCrown(fromPos, forceScale = 1) {
    const { rng, arena, config } = this;
    const minSide = Math.min(arena.width, arena.height);
    const distance = minSide * rng.range(config.ejectDistanceMin, config.ejectDistanceMax) * forceScale;

    let x = fromPos.x;
    let y = fromPos.y;
    const margin = this.crown.radius + 12;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = rng.range(0, Math.PI * 2);
      const candidateX = fromPos.x + Math.cos(angle) * distance;
      const candidateY = fromPos.y + Math.sin(angle) * distance;
      if (
        candidateX > margin &&
        candidateX < arena.width - margin &&
        candidateY > margin &&
        candidateY < arena.height - margin
      ) {
        x = candidateX;
        y = candidateY;
        break;
      }
      // Last attempt: accept a clamped position rather than dropping it
      // back on the ex-holder's feet.
      if (attempt === 7) {
        x = Math.max(margin, Math.min(arena.width - margin, candidateX));
        y = Math.max(margin, Math.min(arena.height - margin, candidateY));
      }
    }

    this.crown.dropped = true;
    this.crown.holderId = null;
    this.crown.x = x;
    this.crown.y = y;
    this.crown.vx = 0;
    this.crown.vy = 0;
    // Brief cooldown so whoever is standing at the landing spot can't
    // scoop it up in the very same frame it arrives.
    this.transferCooldown = this.config.transferCooldown;
  }

  /**
   * A dropped crown now sits still at its landing spot, so this is just
   * pickup detection. (It used to slide with velocity + friction, which
   * was removed along with the physics-launch drop - see ejectCrown.
   * Landing at a definite, visible spot reads far better on screen: a
   * sliding crown was hard to chase because its resting place wasn't
   * apparent until it had already stopped.)
   */
  updateDroppedCrown(_dt) {
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
    list.push({ type: 'crown', x: this.crown.x, y: this.crown.y, r: this.crown.radius, floating: this.crown.dropped });
    return list;
  }
}
