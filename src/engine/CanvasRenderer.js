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

  // ---- Players / hazards: a circle with a simple face -------------------
  draw_blob(d) {
    const { ctx } = this;

    if (d.onFire) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,120,60,0.35)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = d.fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();

    if (d.face) {
      ctx.fillStyle = '#2b2b2b';
      const eyeOffset = d.r * 0.35;
      const eyeR = d.r * 0.11;
      ctx.beginPath();
      ctx.arc(d.x - eyeOffset, d.y - d.r * 0.05, eyeR, 0, Math.PI * 2);
      ctx.arc(d.x + eyeOffset, d.y - d.r * 0.05, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (d.crowned) this.draw_crown({ x: d.x, y: d.y - d.r - 14, r: 12 });

    if (typeof d.timerFrac === 'number') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(d.x - d.r, d.y - d.r - 14, d.r * 2, 6);
      ctx.fillStyle = '#ffce54';
      ctx.fillRect(d.x - d.r, d.y - d.r - 14, d.r * 2 * Math.max(0, d.timerFrac), 6);
    }

    if (d.label) {
      ctx.font = '600 12px "Nunito", sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, d.x, d.y + d.r + 16);
    }
  }

  // ---- Organic Disposal --------------------------------------------------
  draw_sawWall(d) {
    const { ctx } = this;
    ctx.fillStyle = '#5b5b5b';
    ctx.fillRect(d.x, d.y, d.width, d.height);
    const teeth = Math.floor(d.height / 34);
    ctx.fillStyle = '#c9c9c9';
    for (let i = 0; i < teeth; i++) {
      ctx.beginPath();
      ctx.arc(d.width * 0.7, 20 + i * 34, 16, 0, Math.PI * 2);
      ctx.fill();
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
