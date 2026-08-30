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
      this.dropCrownAt(holder ?? { x: this.arena.width / 2, y: this.arena.height / 2 }, 0);
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
          this.crown.holderId = p.id;
          this.transferCooldown = this.config.transferCooldown;
          this.bus?.emit?.('crown:stolen', { from: holder.id, to: p.id });
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
      this.dropCrownAt(holder, this.config.fumbleForce * this.chaos.intensity);
    }
  }

  dropCrownAt(fromPos, force) {
    this.crown.dropped = true;
    this.crown.holderId = null;
    const angle = this.rng.range(0, Math.PI * 2);
    this.crown.x = fromPos.x;
    this.crown.y = fromPos.y;
    this.crown.vx = Math.cos(angle) * force;
    this.crown.vy = Math.sin(angle) * force;
    this.transferCooldown = this.config.transferCooldown;
  }

  updateDroppedCrown(dt) {
    this.crown.x += this.crown.vx * dt;
    this.crown.y += this.crown.vy * dt;
    const f = Math.pow(this.config.crownFriction, dt * 60);
    this.crown.vx *= f;
    this.crown.vy *= f;
    this.crown.x = Math.max(this.crown.radius, Math.min(this.arena.width - this.crown.radius, this.crown.x));
    this.crown.y = Math.max(this.crown.radius, Math.min(this.arena.height - this.crown.radius, this.crown.y));

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
