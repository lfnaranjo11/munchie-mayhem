export class HUD {
  constructor(root) {
    this.root = root;
  }

  update({ minigameName, players, timeRemaining, targetScore }) {
    const scores = players
      .map((p) => `<span class="hud-score" style="--c:${p.color}">${p.name}: ${p.score}/${targetScore}${p.alive ? '' : ' 💀'}</span>`)
      .join('');

    this.root.innerHTML = `
      <div class="hud-bar">
        <div class="hud-title">${minigameName ?? ''}</div>
        <div class="hud-timer">${timeRemaining != null ? `${Math.ceil(timeRemaining)}s` : ''}</div>
        <div class="hud-scores">${scores}</div>
      </div>
    `;
  }
}
