/**
 * InstructionScreen.js - shows the upcoming minigame's rules and waits for
 * each local human player to "ready up" (Space / Enter), mirroring the
 * reference game's "P1 OK / P2 OK" screen. Bots don't need to ready up.
 * A safety timeout auto-advances after 8s so a solo/bot-heavy session
 * never gets stuck waiting for a key nobody's going to press.
 */
export class InstructionScreen {
  /** @param {import('../core/deviceProfile.js').DeviceProfile} [profile] */
  constructor(root, input, profile = { isTouch: false }) {
    this.root = root;
    this.input = input;
    this.profile = profile;
  }

  show(def, humanCount, onReady) {
    this.root.style.display = 'flex';
    const hint = this.profile.isTouch
      ? 'Tap anywhere to start'
      : `${humanCount >= 1 ? 'P1: Space to ready up' : ''}${humanCount >= 2 ? ' &middot; P2: Enter to ready up' : ''}`;

    this.root.innerHTML = `
      <div class="instruction-card">
        <div class="instruction-icon">${def.icon}</div>
        <h2>${def.title}</h2>
        <ul>${def.instructions.map((line) => `<li>${line}</li>`).join('')}</ul>
        <p class="ready-hint">${hint}</p>
        ${this.profile.isTouch ? '<button id="ready-btn">Start</button>' : ''}
      </div>
    `;

    this.readyState = new Set();
    this.needed = Math.min(humanCount, 2);
    this.onReadyCb = onReady;
    // Must reset per-show: this instance is reused for every round, so a
    // stale `true` from the previous round would block the next one from
    // ever starting.
    this._done = false;

    // On touch, an explicit button (plus tapping the overlay anywhere) is
    // far clearer than relying on the joystick's ready-tap flag, which the
    // player can't see and might trigger accidentally while the card is up.
    if (this.profile.isTouch) {
      this._tapHandler = () => this.finish();
      this.root.addEventListener('click', this._tapHandler);
    }

    this.pollHandle = setInterval(() => this.poll(), 100);
    this.timeoutHandle = setTimeout(() => this.finish(), 8000);
  }

  poll() {
    if (this.input.isReadyPressed(0)) this.readyState.add(0);
    if (this.input.isReadyPressed(1)) this.readyState.add(1);
    if (this.readyState.size >= this.needed) this.finish();
  }

  finish() {
    // On touch there are now three independent paths that can end this
    // screen (the Start button, a tap on the overlay, and the poll loop
    // seeing the joystick's ready flag), plus the safety timeout. Without
    // this guard they can race and call onReadyCb twice, which would start
    // the round twice - so bail if we've already finished.
    if (this._done) return;
    this._done = true;

    clearInterval(this.pollHandle);
    clearTimeout(this.timeoutHandle);
    if (this._tapHandler) {
      this.root.removeEventListener('click', this._tapHandler);
      this._tapHandler = null;
    }
    this.root.style.display = 'none';
    this.onReadyCb?.();
  }
}
