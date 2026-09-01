/**
 * TouchInputManager.js - on-screen controls for phones/tablets.
 *
 * Implements the EXACT same interface as InputManager (`getDirection(slot)`
 * and `isReadyPressed(slot)`), which is why adding mobile support needed
 * no changes at all inside TournamentManager or any minigame - see
 * src/network/InputSource.js for the same contract explained in the
 * multiplayer context. Anything that consumes input just asks for a
 * direction vector and never learns where it came from.
 *
 * CONTROL SCHEME - a "floating" joystick rather than a fixed one:
 * Touching anywhere in the play area plants the joystick's origin at that
 * exact point; dragging from there steers. Lifting your finger re-centers
 * and stops the player. This beats a fixed on-screen stick on a phone
 * because there's no need to look down and find a control - wherever your
 * thumb lands IS the control, so your eyes stay on the game. The origin
 * also re-anchors if you drag well past the dead zone, so a long drag
 * can't leave the stick pinned uselessly at full tilt.
 *
 * Only player slot 0 gets touch input: a phone is one person's device
 * (see deviceProfile.js `maxLocalPlayers`), so the other slots are bots.
 */
export class TouchInputManager {
  /**
   * @param {HTMLElement} surface - element that captures touches (the play area)
   * @param {{maxRadius?: number, deadZone?: number}} [opts]
   *   maxRadius how far (CSS px) you drag for full-speed input
   *   deadZone  drag distance below which input reads as zero, so a
   *             stationary thumb doesn't cause creeping drift
   */
  constructor(surface, { maxRadius = 60, deadZone = 8 } = {}) {
    this.surface = surface;
    this.maxRadius = maxRadius;
    this.deadZone = deadZone;

    this.pointerId = null;
    this.origin = { x: 0, y: 0 };
    this.current = { x: 0, y: 0 };
    this.direction = { x: 0, y: 0 };
    this.active = false;
    /** Set by a tap; consumed by isReadyPressed(). */
    this._readyTapped = false;

    // Passive:false is required because these handlers call
    // preventDefault() to stop the browser scrolling/rubber-banding the
    // page while you're steering.
    const opt = { passive: false };
    surface.addEventListener('pointerdown', (e) => this._onDown(e), opt);
    surface.addEventListener('pointermove', (e) => this._onMove(e), opt);
    surface.addEventListener('pointerup', (e) => this._onUp(e), opt);
    surface.addEventListener('pointercancel', (e) => this._onUp(e), opt);
    // Belt and braces: some mobile browsers still fire touchmove-driven
    // scroll even with touch-action CSS set.
    surface.addEventListener('touchmove', (e) => e.preventDefault(), opt);
  }

  _onDown(e) {
    if (this.pointerId !== null) return; // already tracking a finger
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.current = { x: e.clientX, y: e.clientY };
    this.direction = { x: 0, y: 0 };
    this.active = true;
    this._readyTapped = true; // any touch also counts as "ready up"
    this.surface.setPointerCapture?.(e.pointerId);
  }

  _onMove(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.current = { x: e.clientX, y: e.clientY };

    let dx = this.current.x - this.origin.x;
    let dy = this.current.y - this.origin.y;
    const dist = Math.hypot(dx, dy);

    if (dist < this.deadZone) {
      this.direction = { x: 0, y: 0 };
      return;
    }

    // If the finger travels well beyond maxRadius, drag the origin along
    // behind it. Without this, a long swipe leaves the origin far away and
    // the stick stuck at full tilt, so small corrections stop registering.
    if (dist > this.maxRadius) {
      const excess = dist - this.maxRadius;
      this.origin.x += (dx / dist) * excess;
      this.origin.y += (dy / dist) * excess;
      dx = this.current.x - this.origin.x;
      dy = this.current.y - this.origin.y;
    }

    // Normalize to a unit-ish vector, matching InputManager's output range
    // so PlayerController treats both input sources identically.
    const clamped = Math.min(Math.hypot(dx, dy), this.maxRadius);
    const scale = clamped / this.maxRadius;
    const len = Math.hypot(dx, dy) || 1;
    this.direction = { x: (dx / len) * scale, y: (dy / len) * scale };
  }

  _onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.pointerId = null;
    this.active = false;
    this.direction = { x: 0, y: 0 };
  }

  /** Same signature as InputManager.getDirection. Only slot 0 is touch-driven. */
  getDirection(slot) {
    return slot === 0 ? { ...this.direction } : { x: 0, y: 0 };
  }

  /** One-shot: returns true once per tap, then resets. */
  isReadyPressed(slot) {
    if (slot !== 0) return false;
    if (this._readyTapped) {
      this._readyTapped = false;
      return true;
    }
    return false;
  }

  /** Visual state for the DOM joystick overlay (see JoystickOverlay.js).
   * Deliberately just data - this class never touches the DOM itself. */
  getVisualState() {
    return {
      active: this.active,
      originX: this.origin.x,
      originY: this.origin.y,
      knobX: this.origin.x + this.direction.x * this.maxRadius,
      knobY: this.origin.y + this.direction.y * this.maxRadius,
      radius: this.maxRadius,
    };
  }
}
