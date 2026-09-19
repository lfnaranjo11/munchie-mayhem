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
/**
 * True for anything the player might be typing into. Game input must stay
 * completely out of the way of these - see the keydown handler below.
 */
function isTextEntry(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

const DEFAULT_BINDINGS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', ready: 'Space' }, // P1
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ready: 'Enter' }, // P2
];

export class InputManager {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.keys = new Set();

    window.addEventListener('keydown', (e) => {
      // CRITICAL: do nothing at all while the player is typing.
      //
      // WASD are bound to player 1, so without this check every keydown
      // handler below fired for text input too - and `preventDefault()`
      // on a bound key meant typing "a", "s", "d", "w", space or enter
      // into ANY field silently produced nothing. That made it literally
      // impossible to type a name containing those letters, which is
      // most names.
      if (isTextEntry(e.target)) return;

      this.keys.add(e.code);
      // Stop arrow keys / space scrolling the page mid-game.
      if (this._isBoundKey(e.code)) e.preventDefault();
    });

    // keyup is handled unconditionally: if a key went down before focus
    // moved into a field, we still need to hear it released, or the
    // player keeps "holding" a direction forever.
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Entering a text field clears everything held, so a direction that
    // was down at that moment doesn't stick.
    window.addEventListener('focusin', (e) => {
      if (isTextEntry(e.target)) this.keys.clear();
    });
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
