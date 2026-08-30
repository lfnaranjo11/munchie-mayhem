/**
 * GameLoop - a fixed-timestep loop using the standard "accumulator" pattern.
 *
 * WHY FIXED TIMESTEP:
 * requestAnimationFrame fires at whatever rate the browser/monitor gives
 * you (60Hz, 120Hz, a throttled background tab, etc.). If physics were
 * stepped directly by that variable delta, the SAME inputs could produce
 * DIFFERENT outcomes depending on frame rate - collisions would resolve
 * differently, a juggernaut's timer would drain at a different real-world
 * rate, and the simulation would stop being deterministic (see RNG.js for
 * why determinism matters here).
 *
 * Instead, real time is accumulated into a bucket and drained in fixed
 * `fixedDt` chunks (default 1/60s). `update` is always called with the
 * exact same dt, however many times is needed to catch up. Rendering
 * still happens once per animation frame, using whatever state the last
 * completed physics step produced.
 */
export class GameLoop {
  /**
   * @param {(dt: number) => void} update - called with a constant dt, 0+ times per frame
   * @param {(alpha: number) => void} render - called once per animation frame;
   *   alpha (0..1) is how far into the *next* fixed step we are, in case you
   *   want to interpolate visuals smoothly between physics steps later
   * @param {number} fixedDt - simulation step size in seconds
   */
  constructor(update, render, fixedDt = 1 / 60) {
    this.update = update;
    this.render = render;
    this.fixedDt = fixedDt;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    // Optional (err) => void, set by the caller. See the try/catch in
    // _tick below for why this exists.
    this.onError = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _tick(now) {
    if (!this.running) return;

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Clamp so that e.g. switching browser tabs for a minute doesn't cause
    // the game to try to "catch up" with thousands of physics steps at once
    // (the classic "spiral of death").
    frameTime = Math.min(frameTime, 0.25);

    this.accumulator += frameTime;

    // Without this try/catch, ANY uncaught exception in update() or
    // render() - a bug in a new minigame, a typo, whatever - throws out of
    // this requestAnimationFrame callback, which means the line below
    // that schedules the *next* frame never runs. The result is a
    // permanently frozen game with no visible indication anything went
    // wrong (this is exactly what caused an early "empty canvas" bug: a
    // render() call threw before the game had drawn anything, and the
    // loop simply never ticked again). Catching here means a bad frame
    // stops the game cleanly and visibly (via onError) instead of
    // silently.
    try {
      while (this.accumulator >= this.fixedDt) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }
      this.render(this.accumulator / this.fixedDt);
    } catch (err) {
      console.error('Munchie Mayhem: game loop crashed, stopping.', err);
      this.stop();
      this.onError?.(err);
      return;
    }

    requestAnimationFrame(this._tick);
  }
}
