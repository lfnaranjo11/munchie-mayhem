/**
 * InputManager.js - reads the keyboard for LOCAL players and exposes it as
 * `getDirection(slot) -> {x, y}`.
 *
 * This shape - a plain {x, y} direction vector per player slot - is the
 * contract every input source in the game follows (see
 * src/network/InputSource.js for the full explanation). Bots produce the
 * same shape via BotBrain, and a future networked input source would too.
 * Nothing downstream of this ever needs to know whether a given player's
 * input came from a keyboard, an AI, or the internet.
 */
const DEFAULT_BINDINGS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', ready: 'Space' }, // P1
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ready: 'Enter' }, // P2
];

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      // Prevent arrow keys / space from scrolling the page mid-game.
      if (this._isBoundKey(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  _isBoundKey(code) {
    return this.bindings.some((b) => Object.values(b).includes(code));
  }

  /** @returns {{x:number,y:number}} a direction vector, diagonals normalized to length 1 */
  getDirection(slot) {
    const b = this.bindings[slot];
    if (!b) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.keys.has(b.left)) x -= 1;
    if (this.keys.has(b.right)) x += 1;
    if (this.keys.has(b.up)) y -= 1;
    if (this.keys.has(b.down)) y += 1;
    if (x !== 0 && y !== 0) {
      const s = Math.SQRT1_2;
      x *= s;
      y *= s;
    }
    return { x, y };
  }

  isReadyPressed(slot) {
    const b = this.bindings[slot];
    return b ? this.keys.has(b.ready) : false;
  }
}
