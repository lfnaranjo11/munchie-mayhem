import { MINIGAME_REGISTRY } from '../minigames/registry.js';

export class MenuScreen {
  /** @param {import('../core/deviceProfile.js').DeviceProfile} profile */
  constructor(root, profile) {
    this.root = root;
    this.profile = profile;
    this.startCallback = null;
    this.render();
  }

  render() {
    // On a phone there's exactly one player and one virtual joystick, so
    // the "local players" dropdown would be a single dead option. Drop the
    // control entirely and say so plainly instead of showing a disabled
    // input the player can't act on.
    const singlePlayerOnly = this.profile.maxLocalPlayers < 2;
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
          ${
            singlePlayerOnly
              ? ''
              : `<label>Local players
            <select id="human-count">
              <option value="2" selected>2 (shared keyboard)</option>
              <option value="1">1</option>
            </select>
          </label>`
          }
          <label>Bots
            <input type="number" id="bot-count" min="1" max="5" value="${singlePlayerOnly ? 3 : 2}" />
          </label>
        </div>
        <fieldset id="minigame-toggles">
          <legend>Minigames in rotation</legend>
          ${options}
        </fieldset>
        <button id="start-btn">Start Tournament</button>
        <p class="controls-hint">
          ${
            this.profile.isTouch
              ? 'Touch and drag anywhere on the play area to move &middot; tap to ready up'
              : 'P1: WASD to move, Space to ready up &middot; P2: Arrow keys, Enter to ready up'
          }
        </p>
      </div>
    `;

    this.root.querySelector('#start-btn').addEventListener('click', () => this.handleStart());
  }

  handleStart() {
    const targetScore = Number(this.root.querySelector('#target-score').value) || 3;

    // The dropdown only exists when the device supports 2 local players;
    // otherwise it's always 1 human (phones) plus bots.
    const humanSelect = this.root.querySelector('#human-count');
    const humanPlayers = Math.min(humanSelect ? Number(humanSelect.value) || 1 : 1, this.profile.maxLocalPlayers);

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
