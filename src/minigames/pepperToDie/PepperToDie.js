import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions, resolveObstacleCollision } from '../sharedSteps.js';

/**
 * Pepper to Die - chocolate barriers bounce hard (high restitution), milk
 * cartons just block (low restitution). Whoever grabs the pepper becomes
 * the juggernaut: faster, on fire, and instantly eliminates anyone they
 * touch - but their own countdown timer kills THEM if it runs out first.
 * If nobody grabs the pepper for a while, it stops waiting: it starts
 * hunting the nearest player down (see updatePepperHunt), so the round
 * can never stall out with everyone too scared to pick it up.
 */
export class PepperToDie extends MinigameBase {
  onStart() {
    this.obstacles = this.generateObstacles();
    this.juggernautId = null;
    this.pepperRespawnTimer = 0;
    this.spawnPepper();
  }

  generateObstacles() {
    const { rng, arena, config } = this;
    const list = [];
    for (let i = 0; i < config.chocoCount; i++) {
      list.push({ x: rng.range(80, arena.width - 80), y: rng.range(80, arena.height - 80), radius: config.chocoRadius, restitution: config.chocoRestitution, kind: 'choco' });
    }
    for (let i = 0; i < config.milkCount; i++) {
      list.push({ x: rng.range(80, arena.width - 80), y: rng.range(80, arena.height - 80), radius: config.milkRadius, restitution: config.milkRestitution, kind: 'milk' });
    }
    return list;
  }

  spawnPepper() {
    this.pepper = {
      x: this.rng.range(80, this.arena.width - 80),
      y: this.rng.range(80, this.arena.height - 80),
      radius: this.config.pepperRadius,
      state: 'idle', // 'idle' -> 'hunting' once pepperIdleTimeout elapses unclaimed
      idleTimer: 0,
      targetId: null,
    };
  }

  update(dt, inputs) {
    // The juggernaut moves faster than everyone else - built fresh each
    // frame from the shared movement config so a config-variant change to
    // base speed automatically scales the juggernaut boost too.
    const jugCfg = {
      ...this.config.movement,
      acceleration: this.config.movement.acceleration * this.config.juggernautSpeedMultiplier,
      maxSpeed: this.config.movement.maxSpeed * this.config.juggernautSpeedMultiplier,
    };
    stepPlayersMovement(this.players, inputs, this.arena, dt, (p) => (p.id === this.juggernautId ? jugCfg : this.config.movement));

    for (const p of this.getAlivePlayers()) {
      for (const obs of this.obstacles) resolveObstacleCollision(p, obs, obs.restitution);
    }
    stepPlayerCollisions(this.players, this.config.playerRestitution);

    if (this.juggernautId) {
      this.updateJuggernaut(dt);
    } else if (this.pepper) {
      this.updatePepper(dt);
    } else {
      // Pepper was just consumed (a kill, or the juggernaut timed out) -
      // give a short beat before a fresh one appears.
      this.pepperRespawnTimer -= dt;
      if (this.pepperRespawnTimer <= 0) this.spawnPepper();
    }
  }

  updatePepper(dt) {
    if (this.pepper.state === 'idle') {
      for (const p of this.getAlivePlayers()) {
        if (this.tryClaimPepper(p)) return;
      }
      this.pepper.idleTimer += dt;
      if (this.pepper.idleTimer >= this.config.pepperIdleTimeout) this.startPepperHunt();
    } else {
      this.updatePepperHunt(dt);
    }
  }

  /** @returns {boolean} true if `player` picked up the pepper this call */
  tryClaimPepper(player) {
    const d = Math.hypot(player.x - this.pepper.x, player.y - this.pepper.y);
    if (d < player.radius + this.pepper.radius) {
      this.juggernautId = player.id;
      player.roundState.juggernautTimer = this.config.juggernautDuration;
      this.pepper = null;
      return true;
    }
    return false;
  }

  startPepperHunt() {
    const alive = this.getAlivePlayers();
    if (!alive.length) return;
    // Chase whoever's currently closest, so it visibly "comes for you"
    // rather than beelining across the map at a random pick.
    let target = alive[0];
    let best = Infinity;
    for (const p of alive) {
      const d = Math.hypot(p.x - this.pepper.x, p.y - this.pepper.y);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    this.pepper.state = 'hunting';
    this.pepper.targetId = target.id;
  }

  updatePepperHunt(dt) {
    const target = this.players.find((p) => p.id === this.pepper.targetId);
    if (!target || !target.alive) {
      // Target vanished (eliminated by something else) - retarget almost
      // immediately instead of leaving the pepper chasing a ghost.
      this.pepper.state = 'idle';
      this.pepper.idleTimer = this.config.pepperIdleTimeout;
      return;
    }

    const dx = target.x - this.pepper.x;
    const dy = target.y - this.pepper.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.pepper.x += (dx / dist) * this.config.pepperHuntSpeed * dt;
    this.pepper.y += (dy / dist) * this.config.pepperHuntSpeed * dt;

    if (this.tryClaimPepper(target)) return;
    // Anyone else who happens to cross its path can also snatch it first.
    for (const p of this.getAlivePlayers()) {
      if (p.id === target.id) continue;
      if (this.tryClaimPepper(p)) return;
    }
  }

  updateJuggernaut(dt) {
    const jug = this.players.find((p) => p.id === this.juggernautId);
    if (!jug || !jug.alive) {
      this.juggernautId = null;
      this.pepperRespawnTimer = this.config.pepperRespawnDelay;
      return;
    }

    jug.roundState.juggernautTimer -= dt;
    if (jug.roundState.juggernautTimer <= 0) {
      jug.alive = false;
      this.bus?.emit?.('player:eliminated', { id: jug.id, minigame: 'pepperToDie', reason: 'timeout' });
      this.juggernautId = null;
      this.pepperRespawnTimer = this.config.pepperRespawnDelay;
      return;
    }

    for (const p of this.getAlivePlayers()) {
      if (p.id === jug.id) continue;
      const d = Math.hypot(p.x - jug.x, p.y - jug.y);
      if (d < p.radius + jug.radius) {
        p.alive = false;
        this.bus?.emit?.('player:eliminated', { id: p.id, minigame: 'pepperToDie', reason: 'juggernaut' });
        jug.roundState.juggernautTimer = Math.min(this.config.juggernautDuration, jug.roundState.juggernautTimer + this.config.timerRefreshOnKill);
      }
    }
  }

  getBotIntent(player) {
    if (player.id === this.juggernautId) {
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
      return nearest ? { seek: nearest } : null;
    }
    if (this.juggernautId) {
      const jug = this.players.find((p) => p.id === this.juggernautId);
      if (jug) return { flee: jug };
    } else if (this.pepper) {
      return { seek: this.pepper };
    }
    return null;
  }

  getDrawables() {
    const list = this.obstacles.map((o) => ({ type: o.kind === 'choco' ? 'chocoBlock' : 'milkBlock', x: o.x, y: o.y, r: o.radius }));
    if (this.pepper) list.push({ type: 'pepperPickup', x: this.pepper.x, y: this.pepper.y, r: this.pepper.radius, hunting: this.pepper.state === 'hunting' });
    for (const p of this.getAlivePlayers()) {
      list.push({
        type: 'blob',
        x: p.x,
        y: p.y,
        r: p.radius,
        fill: p.color,
        face: true,
        onFire: p.id === this.juggernautId,
        label: p.name,
        timerFrac: p.id === this.juggernautId ? Math.max(0, (p.roundState.juggernautTimer ?? 0) / this.config.juggernautDuration) : null,
      });
    }
    return list;
  }
}
