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

  // ---- King of the Meal ------------------------------------------------
  draw_crown(d) {
    const { ctx } = this;
    // A floating crown bobs and leans into its drift heading, so its
    // motion reads as a feather being carried rather than a sliding icon.
    if (d.floating) {
      const t = performance.now() / 1000;
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.sin(t * 2.2) * 0.22 + (d.dirX ?? 0) * 0.18);
      ctx.translate(-d.x, -d.y + Math.sin(t * 3.1) * 2.5);
      // Sparkle halo so it stays visible while drifting over clutter.
      ctx.globalAlpha = 0.35 + Math.sin(t * 4) * 0.12;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 1.9, 0, Math.PI * 2);
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
  /** `live: false` renders a dim telegraph line during the beam's "off"
   * pulse - visible, but visibly harmless. */
  draw_beam(d) {
    const { ctx } = this;
    if (d.live) {
      ctx.strokeStyle = '#ff2d2d';
      ctx.lineWidth = d.width;
      ctx.shadowColor = '#ff8080';
      ctx.shadowBlur = 12;
    } else {
      ctx.strokeStyle = 'rgba(255,45,45,0.35)';
      ctx.lineWidth = Math.max(2, d.width * 0.4);
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(d.x1, d.y1);
    ctx.lineTo(d.x2, d.y2);
    ctx.stroke();
  }

  draw_emitter(d) {
    const { ctx } = this;
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(d.x, d.y, 18, 0, Math.PI * 2);
    ctx.fill();
  }
}
