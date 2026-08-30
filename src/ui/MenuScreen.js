import { MINIGAME_REGISTRY } from '../minigames/registry.js';

export class MenuScreen {
  constructor(root) {
    this.root = root;
    this.startCallback = null;
    this.render();
  }

  render() {
    const options = Object.values(MINIGAME_REGISTRY)
      .map(
        (def) => `
        <label class="mg-toggle">
          <input type="checkbox" value="${def.id}" checked />
          <span>${def.icon} ${def.title}</span>
        </label>`
      )
      .join('');

    this.root.innerHTML = `
      <div class="menu-card">
        <h1>Munchie Mayhem</h1>
        <p class="subtitle">Local party minigames &mdash; first to the target score wins the tournament.</p>
        <div class="menu-row">
          <label>Target score
            <input type="number" id="target-score" min="1" max="10" value="3" />
          </label>
          <label>Local players
            <select id="human-count">
              <option value="2" selected>2 (shared keyboard)</option>
              <option value="1">1</option>
            </select>
          </label>
          <label>Bots
            <input type="number" id="bot-count" min="0" max="5" value="2" />
          </label>
        </div>
        <fieldset id="minigame-toggles">
          <legend>Minigames in rotation</legend>
          ${options}
        </fieldset>
        <button id="start-btn">Start Tournament</button>
        <p class="controls-hint">P1: WASD to move, Space to ready up &middot; P2: Arrow keys, Enter to ready up</p>
      </div>
    `;

    this.root.querySelector('#start-btn').addEventListener('click', () => this.handleStart());
  }

  handleStart() {
    const targetScore = Number(this.root.querySelector('#target-score').value) || 3;
    const humanPlayers = Number(this.root.querySelector('#human-count').value) || 1;
    let botCount = Number(this.root.querySelector('#bot-count').value) || 0;
    // Hard requirement: at least two players on the field, one way or another.
    if (humanPlayers + botCount < 2) botCount = 2 - humanPlayers;

    const enabledMinigames = [...this.root.querySelectorAll('#minigame-toggles input:checked')].map((i) => i.value);
    this.startCallback?.({ targetScore, humanPlayers, botCount, enabledMinigames });
  }

  onStart(cb) {
    this.startCallback = cb;
  }

  hide() {
    this.root.style.display = 'none';
  }

  show() {
    this.root.style.display = 'flex';
    this.render();
  }
}
