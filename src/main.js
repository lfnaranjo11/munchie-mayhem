import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { TouchInputManager } from './core/TouchInputManager.js';
import { CompositeInput } from './core/CompositeInput.js';
import { resolveDeviceProfile, detectEnvironment, applyInputOverride, getInputOverrideFromURL } from './core/deviceProfile.js';
import { loadConfig, getVariantFromURL, getSeedFromURL } from './core/ConfigLoader.js';
import { GLOBAL_DEFAULTS } from '../config/global.config.js';
import { CanvasRenderer } from './engine/CanvasRenderer.js';
import { Camera } from './engine/Camera.js';
import { resolveArena } from './core/arenaFit.js';
import { TournamentManager } from './tournament/TournamentManager.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { InstructionScreen } from './ui/InstructionScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { JoystickOverlay } from './ui/JoystickOverlay.js';
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
    this.playArea = document.getElementById('play-area');
    this.renderer = new CanvasRenderer(this.canvas);

    // Resolve how this device should behave (touch vs keyboard, how many
    // local players fit) BEFORE building anything that depends on it.
    this.profile = applyInputOverride(resolveDeviceProfile(detectEnvironment()), getInputOverrideFromURL());
    document.body.classList.toggle('is-touch', this.profile.isTouch);
    document.body.classList.toggle('is-compact', this.profile.isCompact);

    // Both sources are always constructed; CompositeInput takes whichever
    // is actually being used each frame, so a tablet with a keyboard (or a
    // touchscreen laptop) works either way. The device's primary input is
    // listed first, which decides precedence on the rare frame where both
    // report movement at once.
    this.keyboard = new InputManager();
    this.touch = this.profile.isTouch ? new TouchInputManager(this.playArea) : null;
    this.input = new CompositeInput(this.profile.isTouch ? [this.touch, this.keyboard] : [this.keyboard, this.touch]);

    this.joystick = new JoystickOverlay(document.getElementById('joystick-overlay'));
    this.joystick.setEnabled(this.profile.isTouch);

    this.hud = new HUD(document.getElementById('hud'));
    this.menu = new MenuScreen(document.getElementById('menu-screen'), this.profile);
    this.instructionScreen = new InstructionScreen(document.getElementById('instruction-screen'), this.input, this.profile);
    this.resultsScreen = new ResultsScreen(document.getElementById('results-screen'));
    this.tournament = null;

    this.camera = new Camera(GLOBAL_DEFAULTS.camera);
    this.zoomBtn = document.getElementById('zoom-btn');
    this.zoomBtn.addEventListener('click', () => {
      const on = this.camera.toggle();
      this.zoomBtn.classList.toggle('is-active', on);
      this.zoomBtn.textContent = on ? '⌕−' : '⌕+';
      this.zoomBtn.setAttribute('aria-label', on ? 'Zoom out to full arena' : 'Zoom in on my player');
    });

    this.menu.onStart((setup) => this.startTournament(setup));

    window.addEventListener('resize', () => this.handleResize());
    // Rotating a phone fires `resize` inconsistently across browsers, and
    // `orientationchange` is deprecated but still the only signal some
    // Android browsers send promptly. Listening to all three (with a short
    // delay so the viewport has settled to its new size) is the reliable
    // cross-browser combination. visualViewport also fires when the mobile
    // URL bar collapses/expands, which changes usable height mid-game.
    window.addEventListener('orientationchange', () => setTimeout(() => this.handleResize(), 120));
    screen.orientation?.addEventListener?.('change', () => setTimeout(() => this.handleResize(), 120));
    window.visualViewport?.addEventListener('resize', () => this.handleResize());

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

  /**
   * Sizes the canvas to fill the available viewport, and works out the
   * arena shape that matches it.
   *
   * Two earlier versions of this were wrong in instructive ways:
   *   1. Width-only sizing - overflowed vertically on landscape phones.
   *   2. Fit-a-16:9-box-inside-the-viewport - fixed the overflow but left
   *      a small letterboxed band floating in a tall portrait page, the
   *      "screen within a screen" problem.
   * The fix isn't in the canvas sizing at all: the canvas now simply
   * TAKES the available space, and the ARENA adapts its aspect ratio to
   * match (see src/core/arenaFit.js). Play area is held constant, so
   * adapting the shape doesn't hand phone players a bigger or smaller
   * field than desktop players.
   */
  handleResize() {
    // Re-resolve the profile: rotating a phone can flip isPortrait and, on
    // a small tablet, even cross the compact breakpoint.
    this.profile = applyInputOverride(resolveDeviceProfile(detectEnvironment()), getInputOverrideFromURL());
    document.body.classList.toggle('is-compact', this.profile.isCompact);
    document.body.classList.toggle('is-portrait', this.profile.isPortrait);
    document.body.classList.toggle('is-touch', this.profile.isTouch);

    // visualViewport reflects the space actually visible once mobile
    // browser chrome (URL bar, keyboard) is accounted for. window.inner*
    // over-reports on mobile Chrome/Safari while the URL bar is showing,
    // which is a classic source of "the bottom of my game is cut off".
    const vv = window.visualViewport;
    const viewportW = Math.round(vv?.width ?? window.innerWidth);
    const viewportH = Math.round(vv?.height ?? window.innerHeight);

    const chrome = this.profile.isCompact ? 6 : 32; // page padding
    const hudHeight = document.getElementById('hud')?.offsetHeight ?? 0;

    const width = Math.max(240, Math.min(viewportW - chrome, this.profile.isCompact ? Infinity : 1100));
    const height = Math.max(160, viewportH - hudHeight - chrome);

    this.renderer.resize(Math.round(width), Math.round(height));

    // The arena for the NEXT round. Changing it mid-round would teleport
    // hazards and obstacles relative to players, so the live round keeps
    // the arena it started with and simply letterboxes if the device is
    // rotated mid-round (see the uniform-scale + centering in render()).
    this.pendingArena = resolveArena(GLOBAL_DEFAULTS.arena, width / height, {
      minAspect: GLOBAL_DEFAULTS.arena.minAspect,
      maxAspect: GLOBAL_DEFAULTS.arena.maxAspect,
      scale: this.profile.isCompact ? GLOBAL_DEFAULTS.arena.mobileScale : 1,
    });
  }

  async startTournament(setup) {
    const variant = getVariantFromURL();
    const globalConfig = await loadConfig(GLOBAL_DEFAULTS, variant);
    const seed = getSeedFromURL() ?? Date.now();

    this.tournament = new TournamentManager({ ...setup, globalConfig, seed, baseArena: this.pendingArena });
    this.tournament.on('round:instructions', ({ def }) => {
      // Start every round at the full-arena view: the instructions screen
      // is the moment the player is orienting themselves, and inheriting a
      // zoom from the previous round would hide most of the new map.
      this.camera.reset();
      this.zoomBtn.classList.remove('is-active');
      this.zoomBtn.textContent = '⌕+';
      this.instructionScreen.show(def, setup.humanPlayers, () => this.tournament.beginRound());
    });
    this.tournament.on('round:end', (payload) => {
      this.resultsScreen.showRoundResult(payload, () => {
        // Adopt any resize/rotation that happened during the round or the
        // results screen. This must happen BEFORE continueTournament(),
        // because that constructs the next minigame using baseArena -
        // setting it afterwards would always be one round stale.
        if (this.pendingArena) this.tournament.baseArena = this.pendingArena;
        this.tournament.continueTournament();
      });
    });
    this.tournament.on('tournament:end', (champion) => {
      this.resultsScreen.showChampion(champion, () => {
        this.tournament = null;
        this.menu.show();
      });
    });

    // Nothing to zoom in on in a bots-only session, so don't offer a
    // button that would do nothing.
    this.zoomBtn.style.display = setup.humanPlayers > 0 ? 'block' : 'none';

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

    // Minigames work in logical arena units; this maps them onto real
    // canvas pixels, so the physics/logic layer never needs to know
    // anything about screen size.
    //
    // UNIFORM scale (one factor for both axes) plus centering, rather
    // than scaling each axis independently. Independent scaling would
    // stretch circles into ellipses the moment the canvas and arena
    // aspects disagreed - which they briefly do whenever the device is
    // rotated mid-round, since the live round keeps the arena it started
    // with. Letterboxing for a few seconds is a much better failure mode
    // than a distorted play field.
    const scale = Math.min(this.renderer.width / mg.arena.width, this.renderer.height / mg.arena.height);
    const offsetX = (this.renderer.width - mg.arena.width * scale) / 2;
    const offsetY = (this.renderer.height - mg.arena.height * scale) / 2;

    const ctx = this.renderer.ctx;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Optional zoom-on-my-player. A no-op at zoom 1, so the default
    // full-arena view costs nothing. Purely visual - see Camera.js.
    this.camera.update(1, this.tournament.getPrimaryLocalPlayer());
    this.camera.apply(ctx, mg.arena);

    // On a phone-sized canvas the per-player name labels render at a few
    // physical pixels tall - unreadable, and just visual noise crowding
    // the blobs. Strip them here rather than inside any minigame, so the
    // minigames stay device-agnostic and keep emitting the same drawables
    // regardless of screen size.
    let drawables = mg.getDrawables();
    if (!this.profile.showNameLabels) {
      drawables = drawables.map((d) => (d.label ? { ...d, label: null } : d));
    }
    this.renderer.draw(drawables);
    ctx.restore();

    if (this.touch) this.joystick.update(this.touch.getVisualState());

    if (this.tournament.isRoundActive()) this.hud.update(this.tournament.getHUDData());
  }
}

window.addEventListener('DOMContentLoaded', () => new App());
