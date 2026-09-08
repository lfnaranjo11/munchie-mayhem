import { WinnerShowcase } from './WinnerShowcase.js';
import { CHARACTERS } from '../../config/characters.js';

export class ResultsScreen {
  constructor(root) {
    this.root = root;
    this.showcase = null;
    this.characterMap = new Map(CHARACTERS.map((c) => [c.id, c]));
  }

  /**
   * Starts the celebration animation on the freshly-rendered canvas.
   * Winners are drawn front and centre with their own per-character
   * celebration; everyone else is dimmed into the background.
   */
  _startShowcase(players, winnerIds) {
    const canvas = this.root.querySelector('#winner-canvas');
    if (!canvas) return;
    this.showcase?.stop();
    this.showcase = new WinnerShowcase(canvas);
    this.showcase.start(
      players.map((p) => ({
        player: p,
        character: this.characterMap.get(p.characterId) ?? this.characterMap.get(CHARACTERS[0].id),
        isWinner: winnerIds.includes(p.id),
      }))
    );
  }

  showRoundResult({ result, players, roundIndex }, onContinue) {
    this.root.style.display = 'flex';
    const winners = players.filter((p) => result.winners.includes(p.id)).map((p) => p.name);
    const winnerLine = winners.length ? `${winners.join(' & ')} scored a point!` : 'Nobody scored that round.';
    const standings = [...players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `<li>${p.name}: ${p.score}</li>`)
      .join('');

    this.root.innerHTML = `
      <div class="results-card">
        <h2>Round ${roundIndex} complete</h2>
        <canvas id="winner-canvas" class="winner-canvas"></canvas>
        <p>${winnerLine}</p>
        <ol>${standings}</ol>
        <button id="continue-btn">Next round</button>
      </div>
    `;
    this._startShowcase(players, result.winners);
    this.root.querySelector('#continue-btn').addEventListener('click', () => {
      // Stop the animation loop when the screen closes, or it keeps
      // rendering frames behind a hidden overlay for the rest of the game.
      this.showcase?.stop();
      this.root.style.display = 'none';
      onContinue?.();
    });
  }

  showChampion(champion, onRestart, allPlayers) {
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="results-card champion">
        <h2>🏆 ${champion.name} wins the tournament!</h2>
        <canvas id="winner-canvas" class="winner-canvas is-champion"></canvas>
        <button id="restart-btn">Back to menu</button>
      </div>
    `;
    this._startShowcase(allPlayers ?? [champion], [champion.id]);
    this.root.querySelector('#restart-btn').addEventListener('click', () => {
      this.showcase?.stop();
      this.root.style.display = 'none';
      onRestart?.();
    });
  }
}
