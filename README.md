# Munchie Mayhem

A modular, local-multiplayer party-minigame engine: bounce-physics arenas,
five minigames, a point-based tournament wrapper, and an architecture
built to be re-skinned, re-tuned, and eventually rewired for real online
play without a ground-up rewrite.

This is meant to be a real, growing codebase, not a demo - see
[Known simplifications & what's next](#known-simplifications--whats-next)
for an honest list of what's deliberately left for iteration.

## Quick start

```
cd munchie-mayhem
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). `npm run dev`
just runs `npx serve .` - a zero-config static file server, not a custom
build step, per "start with plain HTML/JS." **You do need some static
server** (this one, or `python3 -m http.server`, or any other) - opening
`index.html` directly via `file://` will fail, because browsers block ES
module imports (`import ... from './core/RNG.js'`) from the `file://`
protocol for security reasons. This has nothing to do with the game
itself; any ES-module project has the same requirement.

```
npm test
```

Runs `test/smoke.mjs`, a headless Node script that plays all five
minigames and a full bots-only tournament with no browser at all. Good to
run after any change to game logic. See [Testing](#testing).

## Controls

**Desktop / keyboard**
- **P1**: WASD to move, Space to ready up at the instructions screen
- **P2**: Arrow keys to move, Enter to ready up
- Bots ready up instantly and don't need input

**Phone / touch**
- Touch and drag **anywhere on the play area** to move. The joystick is
  "floating": it plants itself wherever your thumb lands, so you never
  have to look down and find a control. Lift to stop.
- Tap the instruction card (or its Start button) to begin a round.
- One human player plus bots - see [Mobile & responsive](#mobile--responsive).

## Mobile & responsive

Phones are treated as a first-class target, not an afterthought:

- **One player per phone.** `src/core/deviceProfile.js` caps
  `maxLocalPlayers` at 1 on compact touch devices - two people can't share
  a phone-sized virtual joystick, so the remaining slots are filled with
  bots and the menu's player-count dropdown is hidden entirely rather
  than shown as a dead option.
- **The arena adapts its shape to the screen.** This is the fix for the
  "screen within a screen" problem. A fixed 16:9 arena can never fill a
  9:19.5 phone - the mismatch is the *aspect ratio*, not the size. So the
  canvas simply takes the whole viewport, and `src/core/arenaFit.js`
  reshapes the arena to match (tall on a portrait phone, wide in
  landscape) while holding total play **area** constant, so no device
  gets an unfair amount of room. Measured coverage: 96-100% of the
  viewport on iPhone/Pixel/iPad/desktop, ~87% on very tall phones where
  the aspect clamp kicks in (those bands are filled with the minigame's
  own background colour, so they read as seamless rather than boxed).
- **`mobileArenaScale`** (`arena.mobileScale` in `config/global.config.js`)
  shrinks the arena on phones so players and hazards appear
  proportionally bigger. Default 0.9. Note the trade-off: a smaller arena
  also means less room to run, which makes chase-heavy minigames more
  frantic - drop toward 0.75 for a hectic phone build, or set 1 to keep
  phone and desktop balance identical.
- **Zoom button.** A tap toggles a smooth zoom onto your own player
  (`src/engine/Camera.js`). It's purely a view transform - the simulation
  is untouched, so zoom can't affect fairness or determinism, and it
  stays compatible with the lockstep netcode plan. Rounds always start
  zoomed out so you can read the new map. Hidden in bots-only sessions.
- **Touch controls share the keyboard's interface.** `TouchInputManager`
  implements the same `getDirection(slot)` / `isReadyPressed(slot)`
  contract as `InputManager`, so adding mobile support required **zero**
  changes inside `TournamentManager` or any minigame - the same seam that
  makes bots and future networked players interchangeable.
  `CompositeInput` merges both, so touchscreen laptops and tablets with
  keyboards work with either input without special-casing.
- **The joystick is DOM, not canvas.** `src/ui/JoystickOverlay.js` renders
  it as HTML layered over the canvas, keeping `CanvasRenderer` purely for
  game-world drawables (no minigame ever emits a "joystick" drawable).
- **Mobile browser hygiene**, targeted at actual mobile market share
  (Chrome on Android is the majority browser worldwide, with Safari/iOS
  second and Samsung Internet a meaningful third - so these are aimed at
  the Chromium-on-Android path first, not just iOS):
  - `visualViewport` is used for sizing rather than `window.innerWidth/Height`,
    because the latter over-reports on mobile Chrome and Safari while the
    URL bar is showing - a classic cause of "the bottom of my game is cut
    off". Its `resize` event also fires when that bar collapses mid-game.
  - Resize is driven by three listeners (`resize`, the deprecated-but-still-
    needed `orientationchange`, and `screen.orientation.change`) because no
    single one fires reliably across Chrome/Safari/Samsung Internet.
  - `touch-action: none` and `overscroll-behavior: none` stop the page
    scrolling and rubber-banding under your thumb.
  - `user-scalable=no` stops double-tap zoom fighting the joystick drag.
  - 16px form inputs prevent iOS Safari's focus auto-zoom.
  - `env(safe-area-inset-*)` keeps UI clear of notches and home indicators.
  - `100dvh` avoids layout jump when browser chrome collapses.
  - Pointer Events (not touch events) are used throughout, which is the
    well-supported modern path across all of the above.
- **Name labels are dropped** on compact screens where they'd render a few
  pixels tall - stripped in `render()` so minigames stay device-agnostic.

**Testing the mobile layout from a desktop browser**: append
`?forceInput=touch` to the URL to force touch controls and the
single-player profile (`?forceInput=keyboard` forces the opposite). Handy
for checking the joystick without device emulation. Because
`resolveDeviceProfile()` is a pure function taking an explicit
environment object, the phone/desktop/hybrid rules are also unit-tested
headlessly in `test/smoke.mjs`.

## The five minigames

Each is a self-contained folder under `src/minigames/`: one class file
with the rules, one `config.js` with every tunable number. All of them
share the same movement controller, collision math, and chaos-escalation
system - see [Architecture tour](#architecture-tour) below.

| Minigame | File | Core mechanic |
|---|---|---|
| **Organic Disposal** | `organicDisposal/OrganicDisposal.js` | Food drifts in from the right and bounces/drags you depending on impact angle; a grinder wall on the left eliminates players *and* grinds up any hazard that reaches it; a gentle constant current keeps pulling everyone toward it |
| **Pepper to Die** | `pepperToDie/PepperToDie.js` | Bouncy chocolate vs. static milk obstacles; grabbing the pepper makes you a faster juggernaut that instantly eliminates anyone you touch but dies itself if its timer runs out; an unclaimed pepper starts *hunting* the nearest player after a few seconds so the round can't stall |
| **Exploding Fruits** | `explodingFruits/ExplodingFruits.js` | A bomb suddenly marks a random player (nothing you press triggers it), briefly tracks them, then arms in place; run clear before it detonates; explosions leave permanent craters that are lethal to fall into, so the safe area only shrinks over a round |
| **Ketchin' Up** | `ketchinUp/KetchinUp.js` | A rotating ketchup-beam emitter; chocolate obstacles block it until struck, then launch away (harmless bounce, not lethal); the beam pulses on/off early on (real gaps to escape through) and becomes steadily more continuous and faster across three phases - rotate, translate-and-rotate, orbit-everything - shuffled into a random order each round, with a randomized obstacle layout each time too |
| **King of the Meal** | `kingOfTheMeal/KingOfTheMeal.js` | Classic king-of-the-hill: the crown starts on the ground, not on a player, so everyone races for it; holding it scores continuously; getting touched drops it; the arena is 10% bigger and denser with obstacles for chase lines; as the pace ramps up the crown starts fumbling off the holder on its own, with more launch force the faster things get |

The **tournament wrapper** (`src/tournament/TournamentManager.js`) picks a
minigame at random each round (no immediate repeat), runs it until it
reports a result, and awards the winner(s) a point. First to the target
score wins the tournament.

## Architecture tour

```
munchie-mayhem/
├── index.html              entry point - just the DOM shell + <canvas>
├── src/
│   ├── main.js              wires everything together; the only file that
│   │                        knows both "game logic" and "DOM" exist
│   ├── core/                engine primitives, used by every minigame
│   │   ├── RNG.js             seeded PRNG - the only source of randomness
│   │   ├── GameLoop.js         fixed-timestep loop (determinism + stability)
│   │   ├── Physics.js          collision/bounce/drag math, heavily commented
│   │   ├── PlayerController.js the shared "skating" movement feel
│   │   ├── InputManager.js     keyboard → {x,y} direction vectors
│   │   ├── TouchInputManager.js floating virtual joystick, same interface
│   │   ├── CompositeInput.js   merges keyboard + touch for hybrid devices
│   │   ├── deviceProfile.js    pure, testable phone/desktop layout rules
│   │   ├── arenaFit.js         adapts arena shape to the device viewport
│   │   ├── ChaosDirector.js    the "ramp speed if nobody's dying" system
│   │   ├── Entity.js           plain-object player/hazard factories
│   │   ├── EventBus.js         tiny pub/sub (tournament ↔ UI, decoupled)
│   │   └── ConfigLoader.js     deep-merge + ?variant= URL param loading
│   ├── ai/BotBrain.js        steering-behaviour AI shared by every minigame
│   ├── network/InputSource.js documented (not yet wired-up) multiplayer seam
│   ├── engine/CanvasRenderer.js the ONLY file that touches <canvas>
│   ├── engine/Camera.js      zoom-on-player view transform (render-only)
│   ├── engine/CharacterRenderer.js procedural characters (the sprite seam)
│   ├── engine/anim/          squash/stretch, particles, shake, easing
│   ├── minigames/
│   │   ├── MinigameBase.js    the interface every minigame implements
│   │   ├── sharedSteps.js     move-players / bounce-players / bounce-obstacle
│   │   ├── configUtils.js     config precedence (global < minigame < variant)
│   │   ├── registry.js        the one place a new minigame gets plugged in
│   │   └── <fiveFolders>/     one class + one config.js per minigame
│   ├── tournament/TournamentManager.js  round selection, scoring, bot/human input merge
│   └── ui/                  menu / instructions / results / HUD / joystick (all plain DOM)
├── config/
│   ├── global.config.js     baseline arena size, movement, chaos tuning
│   ├── characters.js        character roster + animation tuning knobs
│   └── variants/*.json      example A/B-test deployment overrides
├── styles/main.css          all CSS (the menu/HUD chrome around the canvas)
└── test/smoke.mjs           headless Node test - see Testing
```

**The one rule that makes this modular**: a minigame file only ever
imports from `core/`, `sharedSteps.js`, and `MinigameBase.js`. It never
imports `CanvasRenderer`, never touches `document`/`window`, and never
calls `Math.random()` directly. Everything downstream of that rule -
graphics swapping, headless testing, eventual multiplayer - follows
almost for free.

## Design pillars → where they live in code

The brief called out several things as core to the game's feel. Here's
exactly where each one is implemented, so future tuning has an obvious
starting point:

- **Bounce is the fun, and it should be a little unpredictable.**
  `core/Physics.js` - `resolveElasticCollision` (player↔player),
  `resolveObstacleCollision` (player↔static obstacle), and
  `applyHazardInfluence` (the angle-dependent bounce/drag blend for
  moving hazards). Every restitution/bounce-strength number is a plain
  field in a minigame's `config.js`.
- **If nobody's dying, ramp the speed like crazy.**
  `core/ChaosDirector.js`. `MinigameBase.step()` feeds it automatically
  (diffs alive-player count before/after each update), so a minigame
  never has to remember to call it. Each minigame decides what its own
  `chaos.intensity` multiplies - spawn rate, beam speed, fumble chance,
  whichever knob fits.
- **Skating/momentum feel, subtle, on every minigame.**
  `core/PlayerController.js` - `applyMomentumMovement` is the single
  function every minigame calls (via `sharedSteps.stepPlayersMovement`)
  to move a player. Tune it once, every minigame feels it.
- **Separate game logic from graphics.**
  Minigames' `getDrawables()` return plain data (`{type:'blob', x, y,
  r, fill, ...}`); `engine/CanvasRenderer.js` is the only translator from
  that data to actual canvas calls. Proven by `test/smoke.mjs`, which
  runs every minigame's full simulation in plain Node with no canvas or
  DOM available at all.
- **Version-control the randomness and rhythm.**
  Every "random" thing goes through a seeded `RNG` instance
  (`core/RNG.js`) - never raw `Math.random()`. Every tunable number lives
  in a plain, git-diffable config object (`*/config.js`,
  `config/global.config.js`, `config/variants/*.json`), not hardcoded
  inside logic. `?seed=12345` in the URL reproduces an exact tournament
  for debugging.
- **Modular enough to fork into A/B-tested variant sites.**
  See [Config variants & A/B testing](#config-variants--ab-testing) below.

## Why no physics engine, no framework, no bundler

Worth being explicit about, since "don't reinvent the wheel" was an
explicit ask:

- **Physics**: everything on screen is a circle, or a static shape you
  bounce off. There are no joints, no torque, no constraint solving -
  the entire need is "two circles overlap, separate them, reflect
  velocity," which is the ~90 lines of commented math in `Physics.js`.
  Pulling in Matter.js or a Box2D port would add a real dependency and a
  black box in exchange for solving problems this game doesn't have -
  and since the bounce/drag feel *is* the gameplay, keeping the math
  in-house and hand-tunable (rather than buried in an engine's internals)
  is a feature here, not a shortcut. If a minigame ever needs real
  rotational physics or joints, that's the signal to reach for a library
  for *that* minigame specifically.
- **UI framework**: five plain-object screens (menu, instructions,
  results, HUD) with `innerHTML` and a couple of event listeners don't
  need React/Vue's reactivity model. If the UI grows real complexity
  later (persistent settings, richer HUD animations), that's an easy,
  contained swap - the UI layer already only talks to the rest of the
  game through `TournamentManager`'s events.
- **Bundler**: plain ES modules run directly in any modern browser with
  zero build step, which matches "start with simple HTML/JS in the
  browser." The trade-off is the `file://` restriction mentioned in
  [Quick start](#quick-start). When you outgrow this (TypeScript, npm
  packages, code-splitting), the code is already organized as clean ES
  modules with explicit imports - dropping in Vite at that point is a
  config file, not a restructure.
- **Dependencies overall**: zero runtime dependencies, one dev-time
  static server (`serve`, via `npx`, not even installed). That's a
  deliberate choice for a project this size, not an oversight - see
  `package.json`.

## Characters & animation

Characters are **original designs**, drawn procedurally from data in
`config/characters.js`. Game mechanics aren't protected and reimplementing
them is fine, but character *art* is - so nothing here reproduces any
existing game's assets, and you shouldn't drop ripped sprites in either if
this is going public.

**The animation layer is render-only.** Everything under `src/engine/anim/`
derives its state from game state each frame and is never read back by
physics, minigame rules, or bots. Three things fall out of that one-way
flow:
  - the simulation stays deterministic, so the seeded-RNG guarantee and
    the lockstep multiplayer plan both survive (animation is free to use
    wall-clock timing and unseeded randomness precisely *because* it can't
    feed back);
  - animation runs at display rate (smooth on a 144Hz screen) while
    physics stays locked to its fixed timestep;
  - the headless test suite still covers every minigame without ever
    constructing a VisualState.

What's implemented:

| Piece | File | What it does |
|---|---|---|
| Squash & stretch | `anim/VisualState.js` | Springs, so a collision can knock a character any frame and it recovers continuously. Volume-preserving, so stretching along one axis thins the other. |
| Impact reaction | `anim/VisualState.js` | A sharp deceleration (a real bounce, not just friction) kicks a squash impulse and spawns sparks. |
| Idle life | `anim/VisualState.js` | Bob, lean-into-movement, random blinking, gaze drift. Small details, but perfect stillness is the fastest way to look like a sprite instead of a creature. |
| Expressions | `anim/VisualState.js` | Neutral / happy / scared / dizzy / determined, chosen by priority from context so danger cues beat ambient ones. |
| Particles | `anim/ParticleSystem.js` | Pooled (never grows) dust, impact sparks, explosion debris, elimination poofs. |
| Screen shake | `anim/ParticleSystem.js` | Trauma-based and squared, so hits accumulate smoothly instead of restarting a timer. |
| Easing | `anim/easing.js` | Curves plus a damped spring and a frame-rate-independent `approach()`. |

**Tuning the feel**: every knob is in `ANIMATION_DEFAULTS` in
`config/characters.js` - reach for `squashDamping` (lower = wobblier),
`stretchPerSpeed`, and `impactSquash` first.

**Adding a character**: add an entry to `CHARACTERS`. Nothing else
changes - `TournamentManager` assigns from that list and the renderer
draws whatever body/topping/accent combination it finds.

### Moving to drawn sprites later

`src/engine/CharacterRenderer.js` is the single file to replace. Its whole
public surface is `drawCharacter(ctx, { x, y, radius, character, visual, flags })`.
A sprite-sheet or skeletal (Spine/Rive) implementation takes the same
arguments and uses `visual` to pick a frame and apply the same transform -
so minigames, the renderer's dispatch, and the camera all stay untouched.

Worth staying procedural for a while, though: zero asset load, crisp at
any resolution and DPI, and characters can be recoloured or reshaped from
config for A/B tests. The motion is doing most of the work anyway - it's
worth confirming the game feels good before committing to an art style.

## Adding a new minigame

1. Create `src/minigames/yourGame/YourGame.js` extending `MinigameBase`
   (read `MinigameBase.js`'s doc comment first - it's the full contract).
   Reuse `sharedSteps.js` for movement/collisions unless you have a good
   reason not to.
2. Create `src/minigames/yourGame/config.js`, exporting a
   `defaultConfig` object and a `buildYourGameConfig(globalConfig)`
   function that calls `buildMinigameConfig('yourGame', defaultConfig,
   globalConfig)` (see any existing `config.js` for the pattern).
3. Register it in `src/minigames/registry.js` - id, title, icon,
   instructions array, the class, the config builder. That's the only
   other file that needs to know it exists.
4. If your minigame needs a new visual (not just a circle with a face),
   add a `draw_yourThing(d)` method to `CanvasRenderer.js` and have
   `getDrawables()` emit `{type: 'yourThing', ...}`.
5. Add a case to `test/smoke.mjs`'s coverage - it already iterates
   `MINIGAME_REGISTRY`, so a correctly-registered minigame is
   automatically included with no extra test code needed.

## Config variants & A/B testing

This is the mechanism for "small config changes across many deployed
variants, see what performs better":

```
index.html?variant=chaotic   →  deep-merges config/variants/chaotic.json
index.html?variant=chill     →  deep-merges config/variants/chill.json
index.html                   →  defaults only
```

Because every tunable number lives in plain config objects rather than
hardcoded in game logic, a "variant" is just a small JSON file - easy to
fork per deployment, easy to diff in git, easy to spin up a dozen of
without touching any code. `config/variants/chaotic.json` and
`chill.json` are working examples (faster/slower pace, different chaos
ramp, a couple of per-minigame overrides). To add your own:

1. Copy one of the existing variant JSON files, change what you want.
2. Anything you don't specify falls back to `global.config.js` /
   each minigame's own defaults - you only need to list what's different.
3. Point traffic at `yoursite.com/?variant=yourvariant`.

For genuinely separate deployments (not just a query param - actually
different domains/pages for an SEO-style experiment), the whole project
is static files with no backend, so each "flavor" can just be its own
copy with a different default variant baked in, or the same shared
codebase pointed at with a different `?variant=`. Both work with zero
code changes.

`?seed=12345` is the other reproducibility lever - pins the tournament's
master RNG seed, so the exact same sequence of minigames and events
happens every time. Useful for comparing two configs against the *same*
underlying randomness, or reproducing a specific bug report.

## Online multiplayer

**Implemented.** Up to 4 players per room, via room codes *and* public
quick-match. Empty seats are filled with bots.

```
npm run server        # start the game server (ws://localhost:8080)
npm run dev           # serve the client
```

Then open `http://localhost:5173/` → **Play Online**. To point a client at
a different server: `?server=ws://your-host:8080`. A shared
`?room=ABCD` link joins that room directly.

### Architecture: server-authoritative

The server runs the one true simulation and broadcasts snapshots; clients
send only their input direction and render what comes back.

**This replaces the lockstep plan described in earlier versions of this
file, and the reason is worth recording.** Lockstep (exchange inputs only,
every client simulates identically) depends on bit-identical floating
point across machines. IEEE-754 guarantees that for `+ - * /` and `sqrt`,
but *not* for `Math.sin`, `cos`, `atan2`, `pow` or `hypot` — which this
physics leans on heavily. Two players on different browsers could drift
apart over a few minutes, and lockstep desync is exactly the silent,
hard-to-debug failure mode worth designing away from. Server authority
sidesteps it entirely: there is only one simulation, so there is nothing
to diverge. It also means no player gets a host's latency advantage, and
the match survives any player leaving.

The cost is a round-trip of input latency (see "Client-side prediction"
below) and a server to run — which the numbers made affordable.

### The pieces

| Piece | File | Notes |
|---|---|---|
| Wire protocol | `src/network/protocol.js` | Shared verbatim by client and server, so it can't drift. JSON for now; swap `encode`/`decode` for a binary codec if bandwidth ever matters. |
| Room logic | `src/network/GameRoom.js` | **Transport-agnostic** — never touches a socket. Wraps `TournamentManager`, so online runs the *same* minigame rules as offline. |
| Cloudflare adapter | `server/cloudflare/` | Worker + one Durable Object per room, plus a Matchmaker DO for quick-match. |
| Node adapter | `server/node-server.mjs` | Same `GameRoom`, plain `ws`. Local dev today; drop-in VPS deployment. |
| Client | `src/network/NetworkClient.js` | Fixed-rate input, snapshot buffering, interpolation. |

**The snapshot is just the drawable list.** Minigames already expose their
whole visible state as plain descriptors via `getDrawables()`, so that
list *is* the wire format — no separate serialization layer to write and
keep in sync. Any new minigame is network-ready with no extra work.
Velocity isn't sent; the client derives it by differencing consecutive
snapshots, which it buffers for interpolation anyway.

### Hosting & cost

Cloudflare Durable Objects, because a game room is exactly what a DO is:
a single-threaded, strongly-consistent, stateful actor that scales to zero
when empty. Rooms are isolated by construction and need no database.

- Durable Objects are available on the **Workers Free plan**.
- Workers Paid is **$5/month** minimum and includes DO usage, with **no
  egress/bandwidth charges**.
- Inbound messages bill at **20:1** (20 messages = 1 request); **outbound
  is free** — which suits us, since snapshots (the heavy direction) cost
  nothing.

At 4 players sending input at 20Hz: ~14k billed requests/hour → roughly
**70 hours of live 4-player play per month on the free tier**, several
hundred on the $5 plan. Deploy with `cd server/cloudflare && npx wrangler deploy`.

### Latency budget

Getting online play to feel right was mostly about removing
self-inflicted delay, not network delay:

| Source | Before | Now |
|---|---|---|
| Snapshot rate | 20Hz (50ms) | **30Hz (33ms)** — outbound is free on Cloudflare |
| Interpolation buffer | 100ms | **67ms** (2 snapshot intervals) |
| Own input response | full round trip | **~0ms** (client-side prediction) |

**Client-side prediction** (`NetworkClient.updatePrediction`) simulates
your own character locally and immediately, then eases toward the
authoritative position. It's prediction *without* rollback: we don't
replay an input history against each snapshot, because that needs the
client to reproduce server physics exactly, including collisions it can't
foresee. Instead we predict free movement — most of the time, and all of
what makes input feel responsive — and blend toward the server on
disagreement, snapping if the error exceeds ~90px. A collision therefore
resolves over a few frames (slight softness on impact) rather than
instantly. That's a far better trade than laggy controls. Disable with
`net.predictionEnabled = false` if you want to compare.

### Known gaps / next steps
- **The Cloudflare adapter is written but not verified against real
  Cloudflare infrastructure.** The Node adapter is fully tested end to
  end. The DO game loop uses `setInterval` and deliberately does *not*
  use WebSocket Hibernation during a match (a hibernating object can't
  run a loop) — that's the part to check first under real load, and the
  reason the Node server exists as a fallback.
- **No reconnect.** Dropping mid-match hands your seat to a bot; you'd
  rejoin as a new player.
- **No spectators, no persistent accounts, no anti-cheat.** The server is
  authoritative so clients can't teleport, but there's no rate limiting on
  a malicious flood of messages.

### Testing

```
npm run test:network
```

Boots the real server, connects **four real WebSocket clients**, plays a
match and asserts: distinct seat assignment, room capacity enforcement,
snapshot streaming, that every client receives byte-identical
authoritative state for the same sequence number, that network input
actually moves players, and that the match survives a mid-game
disconnect. These tests have caught several genuine bugs:
- `addPlayer()` sends WELCOME synchronously, but both adapters registered
  the socket *after* calling it, so the first message was dropped and
  clients hung forever.
- `botCount` was computed against a floor of 2 total players, so a
  2-human room got **zero** bots while the lobby UI promised the
  opposite.
- The crown, bombs, the laser beam and the pepper had **no `id`** on their
  drawables. Interpolation matches by id, so they were drawn straight
  from the newest snapshot — teleporting 30x a second while everything
  around them moved smoothly. (The beam additionally needed its `x1,y1,
  x2,y2` endpoints interpolated, not just `x,y`.)
- Ad-hoc random room codes in the test contained letters the room-code
  alphabet deliberately excludes (I/L/O, to avoid mistyping a code read
  aloud), so the server normalized them away and the client landed in a
  different room than it asked for.

## Swapping rendering / game engines later

If you ever move off plain canvas (Phaser, PixiJS, or out of the browser
entirely to Unity/Godot), the split already does most of the work for
you: every minigame's simulation is pure data-in/data-out (`update(dt,
inputs)` mutates plain player/hazard objects; `getDrawables()` returns
plain descriptors) with zero dependency on `CanvasRenderer` or the DOM.
Porting to a new engine means rewriting the renderer to consume the same
`getDrawables()` output and the input layer to produce the same `{x,y}`
shape - the physics, chaos escalation, and minigame rules themselves
don't need to change. That's not "engine-agnostic" in a strict sense (you
would still rewrite the render/input glue), but it's the difference
between porting five small rules files versus rewriting the whole game.

## AI bots

`ai/BotBrain.js` uses reactive steering behaviours (seek / flee / wander)
rather than pathfinding or lookahead - each minigame optionally
implements `getBotIntent(player)` to say "flee the nearest bomb," "seek
the dropped crown," etc.; `BotBrain` just turns that into the same
`{x,y}` direction shape a human's keyboard produces. It's genuinely
reactive (aware of live danger and current objectives) without being
"smart" in a deeper sense. Good enough to fill a lobby and make
single-player-plus-bots fun; if you want a difficulty curve later, the
natural next steps are per-bot reaction delay/noise (easy) or short
lookahead on hazards that telegraph their landing spot (moderate).

## Testing

`npm test` runs `test/smoke.mjs`:

- Confirms the seeded RNG is actually deterministic.
- Runs each of the five minigames' full simulation loop headlessly (no
  browser, no canvas) with randomized fuzz input, asserting no exception,
  no NaN/Infinite positions, and that the round concludes within a
  generous safety cap.
- Runs a complete four-bot tournament end-to-end through
  `TournamentManager`, asserting it reaches a champion.

This is a regression net, not full coverage - there's no assertion yet
on "is the bounce angle correct" or similar gameplay-feel properties
(those are better judged by playing it). Worth extending as rules get
more intricate.

## Known simplifications & what's next

Being upfront about what's deliberately left for iteration rather than
missed:

- **Art/animation is placeholder on purpose** - simple canvas shapes
  (circle + dot eyes), not sprites. `CanvasRenderer.js` is the only file
  that would need to change to bring in real art/animation; every
  minigame's `getDrawables()` output stays the same shape either way.
- **Tie handling on a round timeout** is simplistic (everyone still
  alive gets a point) for the last-player-standing minigames. Fine for
  now; a tiebreaker (most survival time, etc.) would be a small,
  contained change in each minigame's `getResult()`.
- **No persistent settings/accounts** - every tournament starts fresh
  from the menu. Not needed yet; would live entirely in the UI layer.
- **Online multiplayer and richer AI** - see their sections above; both
  are scoped as deliberate, documented next steps rather than gaps.
- **More minigames** - the registry pattern and shared physics/movement
  layer exist specifically so the next one is a new folder plus one line
  in `registry.js`, not a re-architecture.
