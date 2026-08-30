/**
 * InstructionScreen.js - shows the upcoming minigame's rules and waits for
 * each local human player to "ready up" (Space / Enter), mirroring the
 * reference game's "P1 OK / P2 OK" screen. Bots don't need to ready up.
 * A safety timeout auto-advances after 8s so a solo/bot-heavy session
 * never gets stuck waiting for a key nobody's going to press.
 */
export class InstructionScreen {
  constructor(root, input) {
    this.root = root;
    this.input = input;
  }

  show(def, humanCount, onReady) {
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="instruction-card">
        <div class="instruction-icon">${def.icon}</div>
        <h2>${def.title}</h2>
        <ul>${def.instructions.map((line) => `<li>${line}</li>`).join('')}</ul>
        <p class="ready-hint">
          ${humanCount >= 1 ? 'P1: Space to ready up' : ''}${humanCount >= 2 ? ' &middot; P2: Enter to ready up' : ''}
        </p>
      </div>
    `;

    this.readyState = new Set();
    this.needed = Math.min(humanCount, 2);
    this.onReadyCb = onReady;
    this.pollHandle = setInterval(() => this.poll(), 100);
    this.timeoutHandle = setTimeout(() => this.finish(), 8000);
  }

  poll() {
    if (this.input.isReadyPressed(0)) this.readyState.add(0);
    if (this.input.isReadyPressed(1)) this.readyState.add(1);
    if (this.readyState.size >= this.needed) this.finish();
  }

  finish() {
    clearInterval(this.pollHandle);
    clearTimeout(this.timeoutHandle);
    this.root.style.display = 'none';
    this.onReadyCb?.();
  }
}
