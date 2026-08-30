export class ResultsScreen {
  constructor(root) {
    this.root = root;
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
        <p>${winnerLine}</p>
        <ol>${standings}</ol>
        <button id="continue-btn">Next round</button>
      </div>
    `;
    this.root.querySelector('#continue-btn').addEventListener('click', () => {
      this.root.style.display = 'none';
      onContinue?.();
    });
  }

  showChampion(champion, onRestart) {
    this.root.style.display = 'flex';
    this.root.innerHTML = `
      <div class="results-card champion">
        <h2>🏆 ${champion.name} wins the tournament!</h2>
        <button id="restart-btn">Back to menu</button>
      </div>
    `;
    this.root.querySelector('#restart-btn').addEventListener('click', () => {
      this.root.style.display = 'none';
      onRestart?.();
    });
  }
}
