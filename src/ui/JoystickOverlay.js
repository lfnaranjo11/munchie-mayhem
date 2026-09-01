/**
 * JoystickOverlay.js - draws the virtual joystick as DOM elements layered
 * over the canvas.
 *
 * WHY DOM AND NOT THE CANVAS RENDERER:
 * CanvasRenderer's job is "draw the game world from minigame drawables."
 * The joystick isn't part of the game world - it's a control surface, in
 * screen space, that shouldn't scale with the arena or appear in a
 * replay/screenshot of game state. Keeping it in the DOM preserves that
 * separation (no minigame ever emits a "joystick" drawable) and gets us
 * CSS transitions for the fade in/out for free.
 */
export class JoystickOverlay {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div class="joystick-base" aria-hidden="true"><div class="joystick-knob"></div></div>
    `;
    this.base = this.root.querySelector('.joystick-base');
    this.knob = this.root.querySelector('.joystick-knob');
    this.visible = false;
  }

  /** @param {ReturnType<import('../core/TouchInputManager.js').TouchInputManager['getVisualState']>} state */
  update(state) {
    if (state.active !== this.visible) {
      this.visible = state.active;
      this.base.classList.toggle('is-active', state.active);
    }
    if (!state.active) return;

    const size = state.radius * 2;
    this.base.style.width = `${size}px`;
    this.base.style.height = `${size}px`;
    this.base.style.transform = `translate(${state.originX - state.radius}px, ${state.originY - state.radius}px)`;
    this.knob.style.transform = `translate(${state.knobX - state.originX}px, ${state.knobY - state.originY}px)`;
  }

  setEnabled(enabled) {
    this.root.style.display = enabled ? 'block' : 'none';
  }
}
