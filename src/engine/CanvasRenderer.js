import { drawCharacter } from './CharacterRenderer.js';

/**
 * Darkens (amount < 0) or lightens (amount > 0) a hex colour. Used to
 * derive a shading tone for hazards, which only supply a single flat
 * colour but should still get the same soft rounded body treatment as
 * characters. Non-hex inputs (e.g. rgba strings) pass through unchanged.
 */
function shadeColor(hex, amount) {
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return hex;
  const num = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 255) * (1 + amount));
  const g = clamp(((num >> 8) & 255) * (1 + amount));
  const b = clamp((num & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * CanvasRenderer.js - the ONLY file that touches the <canvas> 2D context.
 *
 * LOGIC/GRAPHICS SEPARATION:
 * Every minigame's getDrawables() returns plain data - "a blob at (x,y)
 * with this color", "a beam from here to there" - never canvas calls.
 * This renderer is the sole translator from that declarative list into
 * actual drawing. Two things fall out of that split for free:
 *
 *   1. Re-skinning is a one-file change: swap what draw_blob() etc. do
 *      (simple shapes today -> sprite images later) and every minigame
 *      picks up the new look with zero changes to their own code.
 *   2. Every minigame's logic can be unit-tested in plain Node with no
 *      DOM at all (see test/smoke.mjs) - it never imports this file.
 *
 * Drawables are dispatched by `type` to a `draw_<type>` method below. Add
 * a new visual by adding a new draw_ method; nothing else needs touching.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
  }

  /** Resizes the canvas to `width`x`height` CSS pixels, crisp on high-DPI screens. */
  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // All drawing after this happens in "CSS pixel" coordinates; the
    // transform below handles the DPR scaling transparently.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  /**
   * Draws the playable rectangle.
   *
   * Without this the arena's edge was invisible: the canvas background
   * and the play area were the same colour, so you only discovered the
   * boundary by walking into it. That matters most where the arena is
   * letterboxed (tall phones), because the unused bands look identical to
   * playable space.
   */
  drawArenaFrame(arena) {
    const { ctx } = this;
    ctx.save();
    // Soft inner edge, so the boundary reads without a harsh border.
    ctx.strokeStyle = 'rgba(120, 85, 55, 0.18)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(5, 5, arena.width - 10, arena.height - 10, 14);
    else ctx.rect(5, 5, arena.width - 10, arena.height - 10);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(90, 60, 40, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 2, arena.width - 4, arena.height - 4, 14);
    else ctx.rect(2, 2, arena.width - 4, arena.height - 4);
    ctx.stroke();
    ctx.restore();
  }

  clear(bg) {
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  draw(list) {
    for (const d of list) this.drawOne(d);
  }

  drawOne(d) {
    const fn = this[`draw_${d.type}`];
    this.ctx.save();
    if (fn) fn.call(this, d);
    else this.drawFallback(d);
    this.ctx.restore();
  }

  /** Anything with no matching draw_<type> method still renders as a plain circle
   * rather than silently vanishing - makes typos in a new minigame obvious. */
  drawFallback(d) {
    const { ctx } = this;
    ctx.fillStyle = d.fill || '#999';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r || 10, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Players / hazards ------------------------------------------------
  /**
   * A character or hazard blob.
   *
   * Player blobs carry a `characterId` and an entity `id`; the render loop
   * in main.js attaches the matching character definition and VisualState
   * before this runs. Hazards have neither, so they fall back to a simple
   * body using their own colour - which is why one drawable type covers
   * both without minigames needing to care.
   */
  draw_blob(d) {
    drawCharacter(this.ctx, {
      x: d.x,
      y: d.y,
      radius: d.r,
      character: d.character ?? { fill: d.fill, shade: shadeColor(d.fill, -0.18), body: 'round', topping: 'none', accent: 'none' },
      visual: d.visual ?? null,
      flags: {
        onFire: d.onFire,
        crowned: d.crowned,
        timerFrac: d.timerFrac,
        isSelf: d.isSelf,
        label: d.label,
        face: d.face,
      },
    });
  }

  /** Particles from the render-layer ParticleSystem. */
  draw_particle(d) {
    const { ctx } = this;
    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = d.fill;
    ctx.beginPath();
    ctx.arc(d.x, d.y, Math.max(0.4, d.r), 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Organic Disposal --------------------------------------------------
  /**
   * The grinder wall: a column of spinning saw blades.
   *
   * Blades counter-rotate in alternating directions and are spun from
   * wall-clock time. That's fine here (and consistent with the fire aura)
   * because it's purely cosmetic - the collision test in OrganicDisposal
   * is a simple x-position check that knows nothing about blade angle, so
   * the animation can't affect gameplay or determinism.
   */
  draw_sawWall(d) {
    const { ctx } = this;
    const t = performance.now() / 1000;

    // Housing
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(d.x, d.y, d.width, d.height);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(d.x + d.width - 6, d.y, 6, d.height);

    const spacing = 34;
    const count = Math.ceil(d.height / spacing) + 1;
    const bladeX = d.width * 0.68;
    const radius = 16;

    for (let i = 0; i < count; i++) {
      const cy = 18 + i * spacing;
      // Alternate spin direction so adjacent blades look like meshing gears.
      const dir = i % 2 === 0 ? 1 : -1;
      const angle = t * 5.5 * dir;

      ctx.save();
      ctx.translate(bladeX, cy);
      ctx.rotate(angle);

      // Teeth: a ring of tapered points around the disc.
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath();
      const teeth = 9;
      for (let k = 0; k < teeth; k++) {
        const a0 = (k / teeth) * Math.PI * 2;
        const a1 = ((k + 0.5) / teeth) * Math.PI * 2;
        const a2 = ((k + 1) / teeth) * Math.PI * 2;
        ctx.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
        ctx.lineTo(Math.cos(a1) * (radius * 1.32), Math.sin(a1) * (radius * 1.32));
        ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
      }
      ctx.closePath();
      ctx.fill();

      // Disc body and hub
      ctx.fillStyle = '#b4b4b4';
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8e8e8e';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
      ctx.fill();

      // A single highlighted spoke makes the rotation actually readable -
      // a plain disc spinning looks static no matter how fast it turns.
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -radius * 0.75);
      ctx.lineTo(0, radius * 0.75);
      ctx.stroke();

      ctx.restore();
    }
  }

  /** A fading puff where a hazard got ground up at the saw wall. */
  draw_puff(d) {
    const { ctx } = this;
    const t = 1 - d.life / d.maxLife;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.beginPath();
    ctx.arc(d.x, d.y, 10 + t * 18, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // ---- Exploding Fruits ----------------------------------------------------
  draw_crater(d) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = '#241f1a';
    ctx.fill();
  }

  draw_bomb(d) {
    const { ctx } = this;
    if (d.phase === 'armed') {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.blastRadius * d.blastPreview, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,40,0.18)';
      ctx.fill();
    }
    if (d.phase === 'marked') {
      ctx.beginPath();
      ctx.arc(d.x, d.y - 34, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,40,0.5)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(d.x, d.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#4c9a4c';
    ctx.fill();
    ctx.fillStyle = '#2f2f2f';
    ctx.fillRect(d.x - 3, d.y - 22, 6, 10);
  }

  // ---- Sauce Splash ------------------------------------------------------
  /**
   * The painted board.
   *
   * Drawn as horizontal RUNS rather than one rect per cell: a 44x25 grid
   * is 1,100 cells, and filling each individually every frame is a lot of
   * canvas calls for what is usually a handful of large blocks of colour.
   * Coalescing consecutive same-owner cells in a row typically cuts it to
   * a few dozen draws.
   */
  draw_paintGrid(d) {
    const { ctx } = this;
    const data = d.data;
    for (let row = 0; row < d.rows; row++) {
      let col = 0;
      while (col < d.cols) {
        const owner = data.charCodeAt(row * d.cols + col) - 48;
        if (owner <= 0) {
          col++;
          continue;
        }
        let run = 1;
        while (col + run < d.cols && data.charCodeAt(row * d.cols + col + run) - 48 === owner) run++;
        ctx.fillStyle = d.colors[owner] ?? '#ccc';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(col * d.cellW, row * d.cellH, run * d.cellW + 0.5, d.cellH + 0.5);
        col += run;
      }
    }
    ctx.globalAlpha = 1;
  }

  draw_paintJar(d) {
    const { ctx } = this;
    const t = performance.now() / 1000;
    const bob = Math.sin(t * 3 + d.x * 0.01) * 3;

    ctx.save();
    ctx.translate(0, bob);
    // Halo so a jar stays findable against heavily painted ground.
    ctx.globalAlpha = 0.35 + Math.sin(t * 5) * 0.15;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Jar body
    ctx.fillStyle = '#f3f0e6';
    ctx.strokeStyle = 'rgba(80,55,35,0.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(d.x - d.r * 0.7, d.y - d.r * 0.8, d.r * 1.4, d.r * 1.7, 4);
    else ctx.rect(d.x - d.r * 0.7, d.y - d.r * 0.8, d.r * 1.4, d.r * 1.7);
    ctx.fill();
    ctx.stroke();
    // Contents + lid
    ctx.fillStyle = '#ff6b57';
    ctx.fillRect(d.x - d.r * 0.5, d.y - d.r * 0.1, d.r, d.r * 0.85);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(d.x - d.r * 0.8, d.y - d.r, d.r * 1.6, d.r * 0.35);
    ctx.restore();
  }

  /**
   * The who-owns-what bar. A single stacked bar rather than separate
   * per-player bars, because the question players actually ask is "am I
   * ahead?", which a shared bar answers at a glance.
   */
  draw_coverageBar(d) {
    const { ctx } = this;
    const left = d.x - d.width / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(70,50,35,0.3)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left - 3, d.y - 3, d.width + 6, d.height + 6, 12);
    else ctx.rect(left - 3, d.y - 3, d.width + 6, d.height + 6);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, d.y, d.width, d.height, 9);
    else ctx.rect(left, d.y, d.width, d.height);
    ctx.clip();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(left, d.y, d.width, d.height);

    let cursor = left;
    for (const entry of d.entries) {
      const w = d.width * entry.frac;
      if (w <= 0) continue;
      ctx.fillStyle = entry.color;
      ctx.fillRect(cursor, d.y, w, d.height);
      // Percentage inside its own segment, but only when there's room -
      // a label wider than its segment reads as belonging to a neighbour.
      if (w > 34) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = '700 12px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(entry.frac * 100)}%`, cursor + w / 2, d.y + d.height / 2);
      }
      cursor += w;
    }
    ctx.restore();
    ctx.restore();
  }

  // ---- King of the Meal ------------------------------------------------
  /** Where a hovering crown is going to land. This marker is the whole
   * reason the race is fair: every player gets the same information at
   * the same moment, instead of chasing something unpredictable. */
  draw_crownTarget(d) {
    const { ctx } = this;
    const t = performance.now() / 1000;
    // Ring closes in as the crown approaches, so "how long until I can
    // grab it" is readable at a glance.
    const closing = 1 - (d.progress ?? 0);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * (1.4 + closing * 2.6), 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 0.28 + Math.sin(t * 6) * 0.12;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  draw_crown(d) {
    const { ctx } = this;
    const altitude = d.altitude ?? 0;

    if (d.hovering) {
      // Ground shadow stays at the real position while the crown is drawn
      // lifted - that's what sells "in the air, not reachable".
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      const shrink = 1 - altitude / 90;
      ctx.ellipse(d.x, d.y, d.r * 0.8 * shrink, d.r * 0.3 * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Everything below is drawn at the lifted position.
    ctx.translate(0, -altitude);

    if (d.floating) {
      const t = performance.now() / 1000;
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.sin(t * 2.2) * 0.22);
      ctx.translate(-d.x, -d.y + Math.sin(t * 3.1) * 2.5);
      // Halo so it stays visible over clutter; brighter in flight.
      ctx.globalAlpha = (d.hovering ? 0.5 : 0.35) + Math.sin(t * 4) * 0.12;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * (d.hovering ? 2.3 : 1.9), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(d.x - d.r, d.y + d.r * 0.5);
    ctx.lineTo(d.x - d.r, d.y - d.r * 0.2);
    ctx.lineTo(d.x - d.r * 0.5, d.y + d.r * 0.15);
    ctx.lineTo(d.x, d.y - d.r * 0.6);
    ctx.lineTo(d.x + d.r * 0.5, d.y + d.r * 0.15);
    ctx.lineTo(d.x + d.r, d.y - d.r * 0.2);
    ctx.lineTo(d.x + d.r, d.y + d.r * 0.5);
    ctx.closePath();
    ctx.fill();
    if (d.floating) {
      ctx.strokeStyle = 'rgba(255,210,63,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---- Pepper to Die / Ketchin' Up obstacles ----------------------------
  draw_chocoBlock(d) {
    const { ctx } = this;
    ctx.fillStyle = d.flying ? '#8a5a34' : '#6b3f21';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2, 8);
    else ctx.rect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    ctx.fill();
  }

  draw_milkBlock(d) {
    const { ctx } = this;
    ctx.fillStyle = '#f5ede1';
    ctx.strokeStyle = '#e0a98d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2.3, 6);
    else ctx.rect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2.3);
    ctx.fill();
    ctx.stroke();
  }

  draw_pepperPickup(d) {
    const { ctx } = this;
    if (d.hunting) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(230,67,43,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = '#e6432b';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.r * 0.6, d.r, Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---- Ketchin' Up beam --------------------------------------------------
  /**
   * The beam. Two visually distinct states, because the difference
   * between them is the entire game:
   *   charging - a thin dashed line that thickens as it charges. Clearly
   *              marks where the shot will land without looking lethal.
   *   firing   - thick, bright, glowing. Unmistakably deadly.
   * (During cooldown the minigame emits no beam drawable at all.)
   */
  draw_beam(d) {
    const { ctx } = this;
    ctx.lineCap = 'round';

    if (d.live) {
      // Outer glow, then the core - reads as hot rather than as a line.
      ctx.strokeStyle = 'rgba(255,90,70,0.35)';
      ctx.lineWidth = d.width * 2.2;
      ctx.beginPath();
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
      ctx.stroke();

      ctx.strokeStyle = '#ff2d2d';
      ctx.lineWidth = d.width;
      ctx.shadowColor = '#ff8080';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(2, d.width * 0.32);
      ctx.beginPath();
      ctx.moveTo(d.x1, d.y1);
      ctx.lineTo(d.x2, d.y2);
      ctx.stroke();
      return;
    }

    // Charging: thickens and brightens as the shot approaches, so how
    // long you have left is readable from the line itself.
    const charge = Math.max(0, Math.min(1, d.charge ?? 0));
    const t = performance.now() / 1000;
    ctx.setLineDash([10, 9]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = `rgba(255,70,60,${0.28 + charge * 0.5})`;
    ctx.lineWidth = Math.max(2, d.width * (0.25 + charge * 0.45));
    ctx.beginPath();
    ctx.moveTo(d.x1, d.y1);
    ctx.lineTo(d.x2, d.y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The cannon. Its colour and the ring around it announce which beat of
   * the cycle we're in, so the state is readable even when the beam
   * itself is invisible. */
  draw_emitter(d) {
    const { ctx } = this;
    const t = performance.now() / 1000;

    if (d.phase === 'charge') {
      // Tightening ring = winding up.
      ctx.strokeStyle = 'rgba(255,70,60,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 24 + Math.sin(t * 12) * 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (d.phase === 'moving') {
      // Motion puffs, so a repositioning cannon reads as travelling
      // rather than teleporting.
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 1; i <= 3; i++) {
        const a = (d.angle ?? 0) + Math.PI;
        ctx.beginPath();
        ctx.arc(d.x + Math.cos(a) * i * 13, d.y + Math.sin(a) * i * 13, 7 - i * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Body, tinted by state: bright red only when actually dangerous.
    ctx.fillStyle = d.phase === 'fire' ? '#ff2d2d' : d.phase === 'charge' ? '#c0392b' : '#8d6e63';
    ctx.beginPath();
    ctx.arc(d.x, d.y, 18, 0, Math.PI * 2);
    ctx.fill();

    // Nozzle showing which way it's aiming.
    if (typeof d.angle === 'number') {
      ctx.strokeStyle = 'rgba(60,40,25,0.65)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + Math.cos(d.angle) * 24, d.y + Math.sin(d.angle) * 24);
      ctx.stroke();
    }
  }
}
