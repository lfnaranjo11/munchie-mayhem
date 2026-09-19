import { MinigameBase } from '../MinigameBase.js';
import { stepPlayersMovement, stepPlayerCollisions, resolveObstacleCollision } from '../sharedSteps.js';

/**
 * Sauce Splash - a territory-painting round.
 *
 * Everyone trails sauce as they run. Cover more of the board than anyone
 * else before the timer ends. Painting over someone else's sauce takes
 * that ground from them, so a late run through enemy territory can swing
 * the result - which is what keeps the last twenty seconds tense instead
 * of a foregone conclusion.
 *
 * Sauce jars appear at random and grant a short boost: a wider brush and
 * more speed. They're deliberately placed on the *least* contested ground
 * (see spawnJar), so chasing one pulls you away from the scrum and into
 * open space rather than rewarding whoever already dominates the middle.
 *
 * ── DESIGN NOTES ─────────────────────────────────────────────────────
 * Nobody is eliminated here, which makes it the first minigame decided
 * purely on a score rather than survival. MinigameBase already supports
 * that (King of the Meal overrides the same two methods), so this needed
 * no engine changes.
 *
 * Coverage is tracked INCREMENTALLY in `counts` rather than by scanning
 * the grid each frame. A full scan would be ~1000 cells × 60fps × the
 * number of players; keeping running totals makes it free, and the
 * percentage bar needs an exact figure every frame.
 */
export class SauceSplash extends MinigameBase {
  onStart() {
    const { arena, config } = this;

    // Grid resolution is derived from the arena's aspect so cells stay
    // square-ish on any device (the arena reshapes per screen - see
    // core/arenaFit.js).
    this.cols = config.gridCols;
    this.rows = Math.max(8, Math.round((this.cols * arena.height) / arena.width));
    this.cellW = arena.width / this.cols;
    this.cellH = arena.height / this.rows;
    this.totalCells = this.cols * this.rows;

    // 0 = unpainted, otherwise (player index + 1).
    this.grid = new Uint8Array(this.totalCells);
    this.counts = new Array(this.players.length + 1).fill(0);
    this.counts[0] = this.totalCells;

    this.playerIndex = new Map();
    this.players.forEach((p, i) => {
      this.playerIndex.set(p.id, i + 1);
      p.roundState.boost = 0;
      p.roundState.painted = 0;
    });

    this.obstacles = this.generateObstacles();
    this.jars = [];
    this.jarTimer = config.jar.firstDelay;
    this._jarSeq = 0;

    // Everyone starts with a small claimed patch, so the board isn't a
    // blank slate and the bar has something to show immediately.
    for (const p of this.getAlivePlayers()) this.paintAround(p, config.brushRadius);
  }

  generateObstacles() {
    const { rng, arena, config } = this;
    const list = [];
    for (let i = 0; i < config.obstacleCount; i++) {
      list.push({
        x: rng.range(arena.width * 0.15, arena.width * 0.85),
        y: rng.range(arena.height * 0.15, arena.height * 0.85),
        radius: config.obstacleRadius,
      });
    }
    return list;
  }

  update(dt, inputs) {
    const { config } = this;

    // Boosted players move faster; everyone else uses the shared tuning.
    const boostedCfg = {
      ...config.movement,
      acceleration: config.movement.acceleration * config.jar.speedMultiplier,
      maxSpeed: config.movement.maxSpeed * config.jar.speedMultiplier,
    };
    stepPlayersMovement(this.players, inputs, this.arena, dt, (p) =>
      p.roundState.boost > 0 ? boostedCfg : config.movement
    );

    for (const p of this.getAlivePlayers()) {
      for (const obs of this.obstacles) resolveObstacleCollision(p, obs, config.obstacleRestitution);
    }
    stepPlayerCollisions(this.players, config.playerRestitution);

    for (const p of this.getAlivePlayers()) {
      if (p.roundState.boost > 0) p.roundState.boost -= dt;
      const radius = p.roundState.boost > 0 ? config.brushRadius * config.jar.brushMultiplier : config.brushRadius;
      this.paintAround(p, radius);
    }

    this.updateJars(dt);
  }

  /**
   * Paints every cell whose centre falls within `radius` of the player.
   *
   * Only scans the bounding box of the brush rather than the whole grid,
   * so cost is proportional to brush size, not board size.
   */
  paintAround(player, radius) {
    const owner = this.playerIndex.get(player.id);
    if (!owner) return;

    const minCol = Math.max(0, Math.floor((player.x - radius) / this.cellW));
    const maxCol = Math.min(this.cols - 1, Math.floor((player.x + radius) / this.cellW));
    const minRow = Math.max(0, Math.floor((player.y - radius) / this.cellH));
    const maxRow = Math.min(this.rows - 1, Math.floor((player.y + radius) / this.cellH));
    const radiusSq = radius * radius;

    for (let row = minRow; row <= maxRow; row++) {
      const cy = (row + 0.5) * this.cellH;
      for (let col = minCol; col <= maxCol; col++) {
        const cx = (col + 0.5) * this.cellW;
        const dx = cx - player.x;
        const dy = cy - player.y;
        if (dx * dx + dy * dy > radiusSq) continue;

        const idx = row * this.cols + col;
        const previous = this.grid[idx];
        if (previous === owner) continue;
        // Running totals - see the note in the class header about why
        // this isn't recomputed by scanning.
        this.counts[previous] -= 1;
        this.counts[owner] += 1;
        this.grid[idx] = owner;
      }
    }
  }

  updateJars(dt) {
    const { config } = this;
    this.jarTimer -= dt;
    if (this.jarTimer <= 0 && this.jars.length < config.jar.maxActive) {
      this.spawnJar();
      // Jars arrive faster as the round heats up, so a trailing player
      // always has something to chase.
      this.jarTimer = this.rng.range(config.jar.minInterval, config.jar.maxInterval) / this.chaos.intensity;
    }

    for (const jar of this.jars) {
      jar.age += dt;
    }

    const remaining = [];
    for (const jar of this.jars) {
      let taken = false;
      for (const p of this.getAlivePlayers()) {
        if (Math.hypot(p.x - jar.x, p.y - jar.y) < p.radius + jar.radius) {
          p.roundState.boost = config.jar.boostDuration;
          this.bus?.emit?.('jar:collected', { id: p.id });
          taken = true;
          break;
        }
      }
      // Uncollected jars expire, so the board doesn't fill with clutter.
      if (!taken && jar.age < config.jar.lifetime) remaining.push(jar);
    }
    this.jars = remaining;
  }

  /**
   * Places a jar on the least contested ground it can find.
   *
   * Sampling candidates and picking the one furthest from every player
   * means jars pull people out into open space instead of appearing in
   * the middle of a scrum - which would just reward whoever is already
   * winning the centre.
   */
  spawnJar() {
    const margin = 40;
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < this.config.jar.candidates; i++) {
      const x = this.rng.range(margin, this.arena.width - margin);
      const y = this.rng.range(margin, this.arena.height - margin);
      if (this.obstacles.some((o) => Math.hypot(x - o.x, y - o.y) < o.radius + 30)) continue;

      let nearest = Infinity;
      for (const p of this.getAlivePlayers()) nearest = Math.min(nearest, Math.hypot(x - p.x, y - p.y));
      if (nearest > bestScore) {
        bestScore = nearest;
        best = { x, y };
      }
    }
    if (!best) return;

    this._jarSeq += 1;
    this.jars.push({ id: `jar_${this._jarSeq}`, x: best.x, y: best.y, radius: this.config.jar.radius, age: 0 });
  }

  /** Fraction of the board owned by each player, keyed by player id. */
  getCoverage() {
    const out = new Map();
    for (const p of this.players) {
      const owner = this.playerIndex.get(p.id);
      out.set(p.id, (this.counts[owner] ?? 0) / this.totalCells);
    }
    return out;
  }

  getBotIntent(player) {
    // A boost is worth a detour, but not a trek across the whole board.
    let nearestJar = null;
    let jarDist = Infinity;
    for (const jar of this.jars) {
      const d = Math.hypot(jar.x - player.x, jar.y - player.y);
      if (d < jarDist) {
        jarDist = d;
        nearestJar = jar;
      }
    }
    if (nearestJar && jarDist < this.config.botJarInterest) return { seek: nearestJar };

    // Otherwise head for nearby ground that isn't already ours. Sampling
    // beats scanning the whole grid, and the slight randomness stops all
    // the bots converging on the same cell.
    const owner = this.playerIndex.get(player.id);
    let target = null;
    let bestScore = Infinity;
    for (let i = 0; i < this.config.botSamples; i++) {
      const x = this.rng.range(0, this.arena.width);
      const y = this.rng.range(0, this.arena.height);
      const col = Math.min(this.cols - 1, Math.floor(x / this.cellW));
      const row = Math.min(this.rows - 1, Math.floor(y / this.cellH));
      if (this.grid[row * this.cols + col] === owner) continue;
      const d = Math.hypot(x - player.x, y - player.y);
      if (d < bestScore) {
        bestScore = d;
        target = { x, y };
      }
    }
    return target ? { seek: target } : null;
  }

  // Score-based, not survival-based: the round always runs its full time
  // unless somebody has run away with it.
  isFinished() {
    if (this.elapsed >= this.maxDuration) return true;
    for (const p of this.players) {
      const owner = this.playerIndex.get(p.id);
      if ((this.counts[owner] ?? 0) / this.totalCells >= this.config.dominanceThreshold) return true;
    }
    return false;
  }

  getResult() {
    let winner = null;
    let best = -1;
    for (const p of this.players) {
      const owned = this.counts[this.playerIndex.get(p.id)] ?? 0;
      if (owned > best) {
        best = owned;
        winner = p;
      }
    }
    return { winners: winner && best > 0 ? [winner.id] : [] };
  }

  getDrawables() {
    const coverage = this.getCoverage();

    const list = [
      {
        id: 'paintGrid',
        type: 'paintGrid',
        cols: this.cols,
        rows: this.rows,
        cellW: this.cellW,
        cellH: this.cellH,
        // Packed as one digit per cell. Compact, and it deflates
        // extremely well over the network because painted regions are
        // long runs of the same character.
        data: this.grid.join(''),
        colors: ['transparent', ...this.players.map((p) => p.color)],
      },
    ];

    for (const obs of this.obstacles) {
      list.push({ id: `obs_${this.obstacles.indexOf(obs)}`, type: 'blob', x: obs.x, y: obs.y, r: obs.radius, fill: '#b98b5e', face: false });
    }

    for (const jar of this.jars) {
      list.push({ id: jar.id, type: 'paintJar', x: jar.x, y: jar.y, r: jar.radius, age: jar.age });
    }

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
        label: p.name,
        onFire: p.roundState.boost > 0,
      });
    }

    // The coverage bar is a drawable rather than DOM so it works
    // identically offline and online without any extra plumbing.
    list.push({
      id: 'coverageBar',
      type: 'coverageBar',
      x: this.arena.width / 2,
      y: 26,
      width: this.arena.width * 0.78,
      height: 20,
      entries: this.players.map((p) => ({ color: p.color, frac: coverage.get(p.id) ?? 0 })),
    });

    return list;
  }
}
