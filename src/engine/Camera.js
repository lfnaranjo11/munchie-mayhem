/**
 * Camera.js - view transform for the optional "zoom in on my player"
 * button.
 *
 * WHY THIS IS PURELY A RENDER CONCERN:
 * Zooming changes what the player SEES, never what the simulation DOES.
 * No minigame, physics function, or bot is aware a camera exists - they
 * all keep working in full arena coordinates. That means zoom can't
 * affect fairness or determinism (two players on different zoom levels
 * still simulate identically), and it stays compatible with the lockstep
 * netcode plan in src/network/InputSource.js.
 *
 * The zoom level is smoothed rather than snapping, because an instant
 * jump between full-arena and zoomed-in views is disorienting mid-round.
 */
export class Camera {
  /**
   * @param {{zoomFactor:number, smoothing:number}} cfg
   *   zoomFactor  magnification when zoomed in (2 = twice as big)
   *   smoothing   0..1 per 1/60s tick; how fast the zoom eases toward its
   *               target. Higher = snappier.
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.zoomedIn = false;
    /** Current (animating) zoom, 1 = full arena view. */
    this.zoom = 1;
    this.focusX = 0;
    this.focusY = 0;
  }

  toggle() {
    this.zoomedIn = !this.zoomedIn;
    return this.zoomedIn;
  }

  reset() {
    this.zoomedIn = false;
    this.zoom = 1;
  }

  /**
   * Eases the current zoom toward its target and follows `target`.
   * @param {number} dtScale frames elapsed (1 = one 60Hz tick)
   * @param {{x:number,y:number}|null} target usually the local human player
   */
  update(dtScale, target) {
    const goal = this.zoomedIn ? this.cfg.zoomFactor : 1;
    // Exponential ease, frame-rate independent (same approach as the
    // friction handling in PlayerController.js).
    const t = 1 - Math.pow(1 - this.cfg.smoothing, dtScale);
    this.zoom += (goal - this.zoom) * t;
    if (target) {
      this.focusX = target.x;
      this.focusY = target.y;
    }
  }

  /**
   * Applies the camera transform to an already-scaled context.
   *
   * Called with the context in ARENA units (the caller has already applied
   * the arena→canvas scale), so the maths here is all in arena space. When
   * zoom is 1 this is a no-op, so the desktop/full-view path costs
   * nothing.
   *
   * The visible window is clamped to the arena bounds so zooming near an
   * edge shows the corner of the play field rather than empty space
   * outside it.
   */
  apply(ctx, arena) {
    if (this.zoom <= 1.001) return;

    const viewW = arena.width / this.zoom;
    const viewH = arena.height / this.zoom;

    // Desired top-left of the visible window, centred on the focus point,
    // then clamped so the window never leaves the arena.
    let vx = this.focusX - viewW / 2;
    let vy = this.focusY - viewH / 2;
    vx = Math.max(0, Math.min(arena.width - viewW, vx));
    vy = Math.max(0, Math.min(arena.height - viewH, vy));

    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-vx, -vy);
  }
}
