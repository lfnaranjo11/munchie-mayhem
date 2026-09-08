import { drawCharacter } from '../engine/CharacterRenderer.js';
import { VisualState } from '../engine/anim/VisualState.js';
import { ANIMATION_DEFAULTS } from '../../config/characters.js';
import { easeOutBack, easeOutElastic } from '../engine/anim/easing.js';

/**
 * WinnerShowcase.js - the celebration drawn on the results screen.
 *
 * Reuses CharacterRenderer, so winners are drawn with exactly the same
 * bodies, faces and squash as in-game - no separate "menu art" to keep in
 * sync, and any future sprite swap updates this screen for free.
 *
 * Two things the brief asked for shape the layout:
 *   1. The celebration DEPENDS ON WHO WON - each character has a
 *      `celebration` style in config/characters.js (jump, spin, wiggle,
 *      pulse, flip), so a win by Tomo reads differently from a win by
 *      Brocc.
 *   2. Players who lost are placed IN THE BACKGROUND - drawn smaller,
 *      dimmed, further back and slumped, behind the winner. Draw order
 *      matters here: losers first so the winner overlaps them.
 *
 * Runs its own small animation loop, independent of the game loop, and
 * stops itself when hidden so it can't keep burning frames behind a
 * closed screen.
 */
export class WinnerShowcase {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.elapsed = 0;
    this.entries = [];
    this._tick = this._tick.bind(this);
  }

  /**
   * @param {Array<{player: object, character: object, isWinner: boolean}>} entries
   */
  start(entries) {
    this.entries = entries.map((e) => ({ ...e, visual: new VisualState() }));
    this.elapsed = 0;
    this.lastTime = performance.now();
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this._tick);
    }
  }

  stop() {
    this.running = false;
  }

  _tick(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;
    this._render(dt);
    requestAnimationFrame(this._tick);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 150;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  _render(dt) {
    const { w, h } = this._resize();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const losers = this.entries.filter((e) => !e.isWinner);
    const winners = this.entries.filter((e) => e.isWinner);

    // --- Losers, in the background ---------------------------------------
    // Spread across the back, small and faded. Drawn FIRST so the winner
    // renders on top of them.
    losers.forEach((entry, i) => {
      const spread = losers.length > 1 ? i / (losers.length - 1) - 0.5 : 0;
      const x = w / 2 + spread * w * 0.62;
      const y = h * 0.52;
      const radius = Math.min(w, h) * 0.09;

      entry.visual.update(
        { x, y, vx: 0, vy: 0 },
        dt,
        // `dizzy` gives them the crossed-out defeated face.
        { maxSpeed: 250, dizzy: true },
        ANIMATION_DEFAULTS
      );

      ctx.save();
      // Dimmed and desaturated-by-alpha so they read as "behind" without
      // needing a separate art treatment.
      ctx.globalAlpha = 0.4;
      // A slight downward slump sells defeat more than the face alone.
      ctx.translate(x, y + radius * 0.25);
      ctx.rotate(i % 2 === 0 ? 0.12 : -0.12);
      ctx.translate(-x, -y);
      drawCharacter(ctx, {
        x,
        y,
        radius,
        character: entry.character,
        visual: entry.visual,
        flags: {},
      });
      ctx.restore();
    });

    // --- Winner, front and centre ----------------------------------------
    winners.forEach((entry, i) => {
      const x = w / 2 + (winners.length > 1 ? (i - (winners.length - 1) / 2) * w * 0.24 : 0);
      const baseY = h * 0.62;
      const radius = Math.min(w, h) * 0.17;

      entry.visual.update({ x, y: baseY, vx: 0, vy: 0 }, dt, { maxSpeed: 250, crowned: true }, ANIMATION_DEFAULTS);

      const anim = this._celebrationTransform(entry.character?.celebration ?? 'jump', this.elapsed);

      ctx.save();
      // Entrance pop, so the winner arrives rather than just appearing.
      const intro = Math.min(1, this.elapsed / 0.45);
      const introScale = easeOutBack(intro);
      ctx.translate(x, baseY + anim.y);
      ctx.rotate(anim.rotate);
      ctx.scale(introScale * anim.scaleX, introScale * anim.scaleY);
      ctx.translate(-x, -baseY);

      drawCharacter(ctx, {
        x,
        y: baseY,
        radius,
        character: entry.character,
        visual: entry.visual,
        flags: { crowned: true },
      });
      ctx.restore();

      this._drawSparkles(ctx, x, baseY - radius, radius, this.elapsed + i);
    });
  }

  /**
   * Per-character celebration motion. Each returns an offset/rotation for
   * the current time - this is what makes the win screen depend on WHO
   * won rather than being one generic animation.
   */
  _celebrationTransform(style, t) {
    switch (style) {
      case 'spin':
        return { y: Math.sin(t * 3) * 5, rotate: t * 2.4, scaleX: 1, scaleY: 1 };
      case 'wiggle':
        return { y: Math.sin(t * 6) * 3, rotate: Math.sin(t * 7) * 0.32, scaleX: 1, scaleY: 1 };
      case 'pulse': {
        // Heartbeat-ish double pulse.
        const p = 1 + Math.sin(t * 5) * 0.12 + Math.sin(t * 10) * 0.04;
        return { y: 0, rotate: 0, scaleX: p, scaleY: p };
      }
      case 'flip':
        return { y: Math.sin(t * 2.2) * 10, rotate: Math.sin(t * 2.2) * 0.9, scaleX: 1, scaleY: 1 };
      case 'jump':
      default: {
        // Bouncing hop with squash on landing - the classic celebration.
        const cycle = (t % 1.1) / 1.1;
        const hop = Math.sin(cycle * Math.PI);
        const landing = cycle > 0.85 ? easeOutElastic((cycle - 0.85) / 0.15) : 1;
        return {
          y: -hop * 26,
          rotate: 0,
          scaleX: 1 + (1 - landing) * 0.1,
          scaleY: 1 - (1 - landing) * 0.1,
        };
      }
    }
  }

  _drawSparkles(ctx, cx, cy, radius, t) {
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 1.2;
      const dist = radius * (1.5 + Math.sin(t * 3 + i) * 0.25);
      const s = 2 + Math.abs(Math.sin(t * 4 + i * 1.3)) * 3;
      ctx.globalAlpha = 0.5 + Math.sin(t * 4 + i) * 0.35;
      ctx.fillStyle = i % 2 === 0 ? '#ffd23f' : '#fff3b0';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * 0.7, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
