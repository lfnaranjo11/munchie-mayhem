import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { TouchInputManager } from './core/TouchInputManager.js';
import { CompositeInput } from './core/CompositeInput.js';
import { resolveDeviceProfile, detectEnvironment, applyInputOverride, getInputOverrideFromURL } from './core/deviceProfile.js';
import { loadConfig, getVariantFromURL, getSeedFromURL } from './core/ConfigLoader.js';
import { GLOBAL_DEFAULTS } from '../config/global.config.js';
import { CanvasRenderer } from './engine/CanvasRenderer.js';
import { Camera } from './engine/Camera.js';
import { VisualStateStore } from './engine/anim/VisualState.js';
import { ParticleSystem, ScreenShake } from './engine/anim/ParticleSystem.js';
import { CHARACTERS, ANIMATION_DEFAULTS } from '../config/characters.js';
import { resolveArena } from './core/arenaFit.js';
import { TournamentManager } from './tournament/TournamentManager.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { InstructionScreen } from './ui/InstructionScreen.js';
import { ResultsScreen } from './ui/ResultsScreen.js';
import { JoystickOverlay } from './ui/JoystickOverlay.js';
import { HUD } from './ui/HUD.js';
import { OnlineMenu, getRoomFromURL, getServerURL } from './ui/OnlineMenu.js';
import { NetworkClient } from './network/NetworkClient.js';

/**
 * App - the only place that owns a DOM reference to every screen and
 * wires them together. Deliberately thin: almost everything it does is
 * "construct the pieces, connect their callbacks/events, get out of the
 * way." Game rules live in TournamentManager/minigames; drawing lives in
 * CanvasRenderer; none of that logic lives here.
 */
/**
 * Bumped whenever something visible changes. Logged on boot so you can
 * confirm at a glance which build a browser is actually running - a stale
 * copy or a cached module graph otherwise looks identical to a bug, which
 * has cost real debugging time on this project already.
 */
/**
 * Where the online server lives. Override at runtime with ?server=ws://...
 * which is how you point a deployed client at a local dev server.
 */
const DEFAULT_SERVER_URL = 'ws://localhost:8080';

const BUILD = 'v0.7.0 - online UX: status, takeover, self marker, rematch';

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

    // ---- Animation layer (render-only; see engine/anim/VisualState.js) ----
    // None of this feeds back into the simulation, so it can use wall-clock
    // time and unseeded randomness without breaking determinism.
    this.visuals = new VisualStateStore();
    this.particles = new ParticleSystem();
    this.shake = new ScreenShake();
    this.characterMap = new Map(CHARACTERS.map((c) => [c.id, c]));
    this.lastRenderTime = performance.now();

    this.camera = new Camera(GLOBAL_DEFAULTS.camera);
    this.zoomBtn = document.getElementById('zoom-btn');
    this.zoomBtn.addEventListener('click', () => {
      const on = this.camera.toggle();
      this.zoomBtn.classList.toggle('is-active', on);
      this.zoomBtn.textContent = on ? '⌕−' : '⌕+';
      this.zoomBtn.setAttribute('aria-label', on ? 'Zoom out to full arena' : 'Zoom in on my player');
    });

    // ---- Online play ---------------------------------------------------
    // `net` is non-null only while in an online match. When it is set,
    // render() draws the server's interpolated snapshot instead of a
    // locally simulated tournament - those are the only two modes.
    this.net = null;
    this.netState = null;
    this.onlineMenu = new OnlineMenu(document.getElementById('online-screen'), this.profile);
    this.onlineMenu.onJoin = (opts) => this.joinOnline(opts);
    this.onlineMenu.onCancel = () => this.menu.show();

    this.menu.onStart((setup) => this.startTournament(setup));
    this.menu.onOnline(() => {
      this.menu.hide();
      this.onlineMenu.show(getRoomFromURL());
    });

    // A shared ?room=CODE link should land straight in the online menu
    // with the code filled in - no menu hunting for someone who just
    // tapped a friend's link.
    if (getRoomFromURL()) {
      this.menu.hide();
      this.onlineMenu.show(getRoomFromURL());
    }

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
  /**
   * Draws the server's world. Structurally the same as the offline path -
   * same renderer, same camera, same animation layer - but the drawables
   * come from an interpolated snapshot instead of a local simulation.
   */
  renderOnline() {
    const state = this.net.getInterpolatedState();
    const arena = this.netRound?.arena;
    if (!state || !arena) {
      // No world yet. Say so - a blank canvas here is indistinguishable
      // from a crash, and this is precisely when players are least sure
      // the thing is working.
      this.renderer.clear('#fdeecb');
      if (this.net.connected && this.netRound) this.showNetStatus('Loading the arena…');
      return;
    }
    this.showNetStatus(null);
    this.renderer.clear(state.bg || '#fdeecb');

    const now = performance.now();
    const renderDt = Math.min((now - this.lastRenderTime) / 1000, 0.1);
    this.lastRenderTime = now;

    const msMaxSpeed = this.netRound?.movement?.maxSpeed ?? 250;

    const scale = Math.min(this.renderer.width / arena.width, this.renderer.height / arena.height);
    const offsetX = (this.renderer.width - arena.width * scale) / 2;
    const offsetY = (this.renderer.height - arena.height * scale) / 2;

    const ctx = this.renderer.ctx;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Animate from the interpolated snapshot. vx/vy were derived from the
    // position delta by NetworkClient, so squash, lean and dust all work
    // online exactly as they do offline with no extra data on the wire.
    // Predict our own movement from the input being held right now, so
    // the controls respond immediately rather than after a round trip.
    const localId = this.net.localPlayerId;
    const serverSelf = localId ? state.drawables.find((d) => d.id === localId) : null;
    const predicted = this.net.updatePrediction(renderDt, this.input.getDirection(0), serverSelf);

    const liveIds = new Set();
    let drawables = state.drawables.map((d) => {
      if (d.type !== 'blob' || !d.id) return d;
      liveIds.add(d.id);

      // Our own character is drawn at the predicted position; everyone
      // else at their interpolated authoritative position.
      const isSelf = d.id === localId;
      liveIds.add(d.id);
      const x = isSelf && predicted ? predicted.x : d.x;
      const y = isSelf && predicted ? predicted.y : d.y;
      const vx = isSelf && predicted ? predicted.vx : d.vx ?? 0;
      const vy = isSelf && predicted ? predicted.vy : d.vy ?? 0;

      const visual = this.visuals.get(d.id);
      visual.update({ x, y, vx, vy }, renderDt, { maxSpeed: msMaxSpeed }, ANIMATION_DEFAULTS);
      return {
        ...d,
        x,
        y,
        character: d.characterId ? this.characterMap.get(d.characterId) : undefined,
        visual,
        isSelf,
        // Always label your OWN character, even on a phone where labels
        // are otherwise hidden - knowing which blob is yours matters more
        // than the clutter it costs.
        label: this.profile.showNameLabels || isSelf ? d.label : null,
      };
    });
    this.visuals.prune(liveIds);

    this.particles.update(renderDt);
    this.renderer.draw(drawables);
    this.renderer.draw(this.particles.getDrawables());
    ctx.restore();

    if (this.touch) this.joystick.update(this.touch.getVisualState());

    this.hud.update({
      minigameName: this.netRound?.title,
      players: (state.scores || []).map((sc) => {
        const info = this.netRound?.players?.find((p) => p.id === sc.id);
        const character = info?.characterId ? this.characterMap.get(info.characterId) : null;
        return {
          name: (info?.name ?? '') + (sc.id === localId ? ' (you)' : ''),
          score: sc.score,
          alive: sc.alive,
          color: character?.fill ?? '#ff6b6b',
        };
      }),
      targetScore: 3,
      timeRemaining: state.time,
    });
  }

  /** Brief, non-blocking message for things the player should notice but
   * doesn't need to act on (a bot taking over, a rematch countdown). */
  showToast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

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
      // Clear leftover animation state, or the previous round's dust and
      // mid-squash characters bleed into the new map's first frame. Player
      // ids persist across rounds, so without the clear a character would
      // also inherit its old squash/velocity state at a new spawn point.
      this.particles.clear();
      this.visuals.clear();
      this.shake.reset();
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
    // Discrete effects come from events rather than frame-diffing, because
    // a one-off bang can't be reliably inferred by comparing states.
    this.tournament.on('player:eliminated', ({ id, reason }) => {
      const p = this.tournament.players.find((pl) => pl.id === id);
      if (p) this.particles.emitPoof(p.x, p.y, p.color);
      // A blast is a bigger event than a quiet timeout, so it shakes more.
      const isBlast = reason === 'blast' || reason === 'crater';
      this.shake.add(isBlast ? ANIMATION_DEFAULTS.shakeOnExplosion : ANIMATION_DEFAULTS.shakeOnElimination);
      if (isBlast && p) this.particles.emitExplosion(p.x, p.y);
    });

    this.tournament.on('crown:stolen', () => {
      this.shake.add(0.18);
    });

    this.tournament.on('tournament:end', (champion) => {
      const roster = this.tournament.players;
      this.resultsScreen.showChampion(
        champion,
        () => {
          this.tournament = null;
          this.menu.show();
        },
        roster
      );
    });

    // Nothing to zoom in on in a bots-only session, so don't offer a
    // button that would do nothing.
    this.zoomBtn.style.display = setup.humanPlayers > 0 ? 'block' : 'none';

    this.menu.hide();
    this.tournament.startNextRound();
  }

  /**
   * Shows a full-screen status message during online play. A blank canvas
   * while the first snapshot is in flight reads as "the game is broken",
   * which is exactly the wrong signal at the most fragile moment.
   * @param {string|null} text null hides the overlay
   * @param {{spinner?: boolean, actions?: Array<{label:string, onClick:Function}>}} [opts]
   */
  showNetStatus(text, opts = {}) {
    const el = document.getElementById('net-status');
    if (!text) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = 'flex';
    el.innerHTML = `
      <div class="net-status-card">
        ${opts.spinner === false ? '' : '<div class="net-spinner"></div>'}
        <p>${text}</p>
        <div class="net-actions"></div>
      </div>
    `;
    const actions = el.querySelector('.net-actions');
    for (const a of opts.actions ?? []) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick);
      actions.appendChild(btn);
    }
  }

  /**
   * Connects to the server and joins a room. All the online-specific
   * state lives behind `this.net`; when it's null the game behaves
   * exactly as it always has offline.
   */
  async joinOnline({ roomCode, quick, name }) {
    const url = getServerURL(DEFAULT_SERVER_URL);
    this._lastName = name ?? this._lastName;
    this.showNetStatus(quick ? 'Finding a match…' : 'Connecting…');
    this.net = new NetworkClient({
      url,
      onLobby: (msg) => {
        this.onlineMenu.updateLobby(msg.players);
        // The server sends the room back to 'lobby' after a match ends,
        // so a finished game returns everyone to the waiting room for a
        // rematch instead of stranding them on the win screen.
        if (msg.phase === 'lobby' && this.netRound) {
          this.netRound = null;
          this.netState = null;
          document.getElementById('results-screen').style.display = 'none';
          this.showNetStatus(null);
          this.onlineMenu.showLobby(this.net.roomCode, msg.players, () => this.net.sendReady());
        }
      },
      onRoundStart: (msg) => {
        this.onlineMenu.hide();
        this.showNetStatus(null);
        this.netRound = msg;
        // Identify our own character so we can predict its movement
        // locally instead of waiting a round trip for every input.
        const mine = msg.players?.find((p) => p.inputSlot === this.net.slot);
        this.net.setLocalPlayer(mine?.id ?? null, msg.movement, msg.arena);
        this.camera.reset();
        this.particles.clear();
        this.visuals.clear();
        this.instructionScreen.show(
          { icon: msg.icon, title: msg.title, instructions: msg.instructions },
          0, // online rounds start on the server's timer, not a ready-up
          () => {}
        );
      },
      onRoundEnd: (msg) => {
        this.resultsScreen.showRoundResult(
          {
            result: { winners: msg.winners },
            players: msg.standings.map((s) => ({ ...s, characterId: this.netCharacterFor(s.id) })),
            roundIndex: msg.roundIndex,
          },
          () => {}
        );
        // The server drives the schedule, so auto-dismiss rather than
        // waiting on a click that would desync this client from the room.
        // Match the server's pacing rather than guessing: a client delay
        // longer than the server's round-end timer left the overlay
        // covering the start of the next round.
        const holdMs = Math.max(800, (msg.roundSeconds ?? 2.5) * 1000 - 400);
        clearTimeout(this._resultsTimer);
        this._resultsTimer = setTimeout(() => {
          document.getElementById('results-screen').style.display = 'none';
        }, holdMs);
      },
      onTournamentEnd: (msg) => {
        // CRITICAL: cancel the round-end auto-hide. It targets the same
        // overlay element, so it would fire a second or two later and
        // silently wipe the champion screen - which is why the win
        // screen appeared on some devices and not others. Pure race.
        clearTimeout(this._resultsTimer);
        this.showNetStatus(null);

        const roster = (msg.standings ?? []).map((p) => ({ ...p, color: '#ff6b6b' }));
        this.resultsScreen.showChampion(
          { id: msg.championId, name: msg.championName },
          () => this.leaveOnline(),
          roster
        );
        // Tell people what happens next rather than leaving the screen up
        // with no exit.
        this.showToast(`Back to the lobby in ${msg.lobbyInSeconds ?? 8}s`);
      },
      onError: (msg) => this.onlineMenu.setStatus(`Error: ${msg.code}`),
      onPlayerStatus: (msg) => {
        // Someone's connection went quiet and a bot stepped in (or they
        // came back). Everyone should see it, so a suddenly-erratic
        // teammate isn't mistaken for a bug.
        const who = msg.slot === this.net?.slot ? 'You' : msg.name;
        const verb = msg.takenOver
          ? `${who === 'You' ? 'Your connection dropped — a bot' : `${who} lagged out — a bot`} took over`
          : `${who === 'You' ? 'You are' : `${who} is`} back in control`;
        this.showToast(verb);
      },
      onStatus: (status) => {
        if (status === 'disconnected') {
          // Freezing with no explanation was the old behaviour. Say what
          // happened and always offer a way out.
          this.showNetStatus('Connection lost.', {
            spinner: false,
            actions: [
              { label: 'Reconnect', onClick: () => { this.showNetStatus('Reconnecting…'); this.joinOnline({ roomCode: this.net?.roomCode, name: this._lastName }); } },
              { label: 'Main menu', onClick: () => this.leaveOnline() },
            ],
          });
        }
      },
    });

    try {
      const { roomCode: joined } = await this.net.connect({ roomCode, quick, name });
      this.showNetStatus(null);
      this.onlineMenu.showLobby(joined, [], () => this.net.sendReady());
    } catch (err) {
      this.showNetStatus(null);
      this.onlineMenu.setStatus(err.message || 'Could not connect.');
      this.net = null;
    }
  }

  netCharacterFor(playerId) {
    return this.netRound?.players?.find((p) => p.id === playerId)?.characterId;
  }

  leaveOnline() {
    this.net?.disconnect();
    this.net = null;
    this.netRound = null;
    this.netState = null;
    this.menu.show();
  }

  update(dt) {
    if (this.net) {
      // Online: we don't simulate. Just report this player's intent; the
      // server owns the world and sends back snapshots.
      this.net.setInput(this.input.getDirection(0));
      return;
    }
    if (this.tournament?.isRoundActive()) {
      const inputs = this.tournament.collectInputs(this.input);
      this.tournament.update(dt, inputs);
    }
  }

  /**
   * Advances the animation state for everything on screen, and spawns
   * effects from what it observes.
   *
   * This reads game state and writes only to the visual store / particle
   * system - never the other way round. That one-way flow is what lets the
   * whole animation layer use display-rate timing and unseeded randomness
   * without touching the simulation's determinism (see VisualState.js).
   *
   * Continuous effects (squash, dust) are DERIVED from state here;
   * discrete ones (explosions, eliminations) come from bus events wired up
   * in startTournament, because a one-off bang can't be inferred reliably
   * by diffing frames.
   */
  updateAnimation(mg, dt) {
    const cfg = ANIMATION_DEFAULTS;
    const maxSpeed = mg.config?.movement?.maxSpeed ?? 250;
    const liveIds = new Set();

    for (const p of mg.players) {
      if (!p.alive) continue;
      liveIds.add(p.id);
      const visual = this.visuals.get(p.id);

      // Context flags let each minigame's state drive the character's
      // expression without minigames knowing expressions exist.
      const isJuggernaut = mg.juggernautId === p.id;
      const ctx = {
        maxSpeed,
        onFire: isJuggernaut,
        crowned: mg.crown?.holderId === p.id,
        inDanger: this.isPlayerInDanger(mg, p),
      };

      const prevSpeed = visual.lastSpeed;
      visual.update(p, dt, ctx, cfg);
      const speed = Math.hypot(p.vx, p.vy);

      // Running dust, throttled by a per-character timer so the emission
      // rate doesn't scale with frame rate.
      if (speed > maxSpeed * cfg.dustSpeedThreshold) {
        visual._dustTimer = (visual._dustTimer ?? 0) - dt;
        if (visual._dustTimer <= 0) {
          this.particles.emitDust(p.x, p.y + p.radius * 0.7, p.vx / (speed || 1), p.vy / (speed || 1));
          visual._dustTimer = 0.06;
        }
      }

      // Impact sparks on a sharp deceleration - i.e. a real collision, not
      // just letting go of the stick (friction decelerates far more gently
      // than a bounce, which is why a threshold separates them cleanly).
      if (prevSpeed - speed > cfg.impactParticleThreshold) {
        this.particles.emitImpact(p.x, p.y, '#ffffff');
      }
    }

    // Hazards animate too, so drifting food bobs and squashes like the
    // characters do rather than sliding as rigid discs.
    for (const h of mg.hazards ?? []) {
      liveIds.add(h.id);
      this.visuals.get(h.id).update(h, dt, { maxSpeed: 260 }, cfg);
    }

    // Drop state for anything that's gone, or this leaks an object per
    // hazard spawned over a long session.
    this.visuals.prune(liveIds);
  }

  /**
   * Whether a player should look scared. Kept as one small heuristic here
   * rather than as a method on every minigame, since it's purely cosmetic
   * and each check is a cheap read of already-public minigame state.
   */
  isPlayerInDanger(mg, player) {
    // An armed bomb nearby (Exploding Fruits).
    for (const bomb of mg.bombs ?? []) {
      if (bomb.phase === 'armed' && Math.hypot(bomb.x - player.x, bomb.y - player.y) < 110) return true;
      if (bomb.phase === 'marked' && bomb.targetId === player.id) return true;
    }
    // The juggernaut closing in (Pepper to Die).
    if (mg.juggernautId && mg.juggernautId !== player.id) {
      const jug = mg.players.find((p) => p.id === mg.juggernautId);
      if (jug && Math.hypot(jug.x - player.x, jug.y - player.y) < 130) return true;
    }
    // Standing near the grinders (Organic Disposal).
    if (mg.config?.sawZoneWidth && player.x < mg.config.sawZoneWidth + 90) return true;
    return false;
  }

  render() {
    if (this.net) {
      this.renderOnline();
      return;
    }
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

    // Real elapsed time since the last RENDER frame. Deliberately not the
    // simulation's fixed dt: animation should run at display rate (so it
    // looks smooth on a 144Hz screen) and, unlike physics, nothing depends
    // on it being reproducible.
    const now = performance.now();
    const renderDt = Math.min((now - this.lastRenderTime) / 1000, 0.1);
    this.lastRenderTime = now;

    this.updateAnimation(mg, renderDt);
    this.particles.update(renderDt);
    this.shake.update(renderDt);

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
    const shakeOffset = this.shake.getOffset();
    ctx.save();
    // Shake is applied in canvas pixels, outside the arena scale, so its
    // magnitude is consistent regardless of how zoomed the view is.
    ctx.translate(offsetX + shakeOffset.x, offsetY + shakeOffset.y);
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

    // Attach the character definition and animation state to each blob.
    // Done HERE rather than inside minigames on purpose: minigames stay
    // art-agnostic and keep emitting plain data, so this whole layer can
    // be swapped for sprites without touching a single gameplay file.
    drawables = drawables.map((d) => {
      if (d.type !== 'blob' || !d.id) return d;
      return {
        ...d,
        character: d.characterId ? this.characterMap.get(d.characterId) : undefined,
        visual: this.visuals.get(d.id),
      };
    });

    // Particles render above the world but below UI badges.
    this.renderer.draw(drawables);
    this.renderer.draw(this.particles.getDrawables());
    ctx.restore();

    if (this.touch) this.joystick.update(this.touch.getVisualState());

    if (this.tournament.isRoundActive()) this.hud.update(this.tournament.getHUDData());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.log(`%cMunchie Mayhem ${BUILD}`, 'color:#ff6b57;font-weight:bold');
  new App();
});
