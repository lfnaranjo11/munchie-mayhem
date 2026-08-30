import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { loadConfig, getVariantFromURL, getSeedFromURL } from './core/ConfigLoader.js';
import { GLOBAL_DEFAULTS } from '../config/global.config.js';
import { CanvasRenderer } from './engine/CanvasRenderer.js';
import { TournamentManager } from './tournament/TournamentManager.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { InstructionScreen } from './ui/InstructionScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { HUD } from './ui/HUD.js';

/**
 * App - the only place that owns a DOM reference to every screen and
 * wires them together. Deliberately thin: almost everything it does is
 * "construct the pieces, connect their callbacks/events, get out of the
 * way." Game rules live in TournamentManager/minigames; drawing lives in
 * CanvasRenderer; none of that logic lives here.
 */
class App {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new CanvasRenderer(this.canvas);
    this.input = new InputManager();
    this.hud = new HUD(document.getElementById('hud'));
    this.menu = new MenuScreen(document.getElementById('menu-screen'));
    this.instructionScreen = new InstructionScreen(document.getElementById('instruction-screen'), this.input);
    this.resultsScreen = new ResultsScreen(document.getElementById('results-screen'));
    this.tournament = null;

    this.menu.onStart((setup) => this.startTournament(setup));
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    this.loop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render()
    );
    this.loop.onError = (err) => this.showCrash(err);
    this.loop.start();
  }

  /** If update()/render() ever throws, GameLoop stops itself and calls this -
   * see the try/catch in GameLoop.js for why that matters. Shown instead of
   * a silent frozen canvas so a bug is immediately obvious, with the actual
   * error visible right here (not just in devtools) for quick debugging. */
  showCrash(err) {
    const el = document.getElementById('crash-screen');
    el.style.display = 'flex';
    const message = (err?.stack || err?.message || String(err)).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    el.innerHTML = `
      <div class="results-card crash-card">
        <h2>⚠️ Something broke and the game stopped</h2>
        <p>This is the actual error - screenshot it or check the console for the full trace.</p>
        <pre>${message}</pre>
        <button id="crash-reload">Reload</button>
      </div>
    `;
    el.querySelector('#crash-reload').addEventListener('click', () => window.location.reload());
  }

  handleResize() {
    const width = Math.min(window.innerWidth - 32, 1100);
    const height = width * (540 / 960);
    this.renderer.resize(width, height);
  }

  async startTournament(setup) {
    const variant = getVariantFromURL();
    const globalConfig = await loadConfig(GLOBAL_DEFAULTS, variant);
    const seed = getSeedFromURL() ?? Date.now();

    this.tournament = new TournamentManager({ ...setup, globalConfig, seed });
    this.tournament.on('round:instructions', ({ def }) => {
      this.instructionScreen.show(def, setup.humanPlayers, () => this.tournament.beginRound());
    });
    this.tournament.on('round:end', (payload) => {
      this.resultsScreen.showRoundResult(payload, () => this.tournament.continueTournament());
    });
    this.tournament.on('tournament:end', (champion) => {
      this.resultsScreen.showChampion(champion, () => {
        this.tournament = null;
        this.menu.show();
      });
    });

    this.menu.hide();
    this.tournament.startNextRound();
  }

  update(dt) {
    if (this.tournament?.isRoundActive()) {
      const inputs = this.tournament.collectInputs(this.input);
      this.tournament.update(dt, inputs);
    }
  }

  render() {
    const mg = this.tournament?.currentMinigame;
    // A minigame exists (so the instructions screen can show its title)
    // well before it's actually started - onStart() only runs once the
    // players ready up. getDrawables() reads state onStart() sets up, so
    // it isn't safe to call before `started` is true. (This used to be
    // missing and was the exact cause of "empty canvas after readying up":
    // getDrawables() threw on uninitialized state, which - because it's
    // called from inside a requestAnimationFrame callback - silently
    // killed the entire render loop the instant a round began.)
    if (!mg?.started) {
      this.renderer.clear(mg?.backgroundColor ?? '#fdeecb');
      return;
    }
    this.renderer.clear(mg.backgroundColor);

    // Minigames work in fixed logical arena units (see global.config.js);
    // this scales that onto however big the canvas actually is on screen,
    // so the physics/logic layer never needs to know real pixel sizes.
    const scaleX = this.renderer.width / mg.arena.width;
    const scaleY = this.renderer.height / mg.arena.height;
    const ctx = this.renderer.ctx;
    ctx.save();
    ctx.scale(scaleX, scaleY);
    this.renderer.draw(mg.getDrawables());
    ctx.restore();

    if (this.tournament.isRoundActive()) this.hud.update(this.tournament.getHUDData());
  }
}

window.addEventListener('DOMContentLoaded', () => new App());
