/**
 * test/browser-boot.mjs - boots the REAL app in a simulated DOM (jsdom)
 * and plays a round, asserting that characters actually reach the canvas.
 *
 * Why this exists: test/smoke.mjs deliberately never touches the DOM, so
 * it proves the SIMULATION is correct but can say nothing about whether
 * anything is visible. Two bugs so far ("empty canvas after readying up",
 * and a suspected missing-characters bug) lived exactly in that gap - in
 * the wiring between game state and the screen. This closes it.
 *
 * The 2D context is stubbed: we're checking that draw calls are issued
 * with sane arguments, not comparing pixels.
 *
 * Run with: npm run test:browser
 */
import { JSDOM } from 'jsdom';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:5173/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// Stub a 2D context: we want JS exceptions, not pixels.
const drawn = [];
const ctxProxy = new Proxy({}, {
  get(t, prop) {
    if (prop === 'canvas') return {};
    return (...a) => { drawn.push(String(prop)); };
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => ctxProxy;

// Globals main.js touches
global.window = window;
global.document = window.document;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.screen = window.screen;
const _t0 = Date.now();
const fakePerf = { now: () => Date.now() - _t0 };
Object.defineProperty(global, 'performance', { value: fakePerf, configurable: true });
Object.defineProperty(window, 'performance', { value: fakePerf, configurable: true });
global.HTMLElement = window.HTMLElement;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener(){}, removeEventListener(){} }));
let rafCbs = [];
global.requestAnimationFrame = window.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
global.fetch = async () => ({ ok: false });

const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));
process.on('uncaughtException', e => errors.push('uncaught: ' + e.stack));
// A rejected top-level await would otherwise exit 0 with no output, which
// is exactly how a broken import path in this harness hid itself once.
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e);
  process.exit(1);
});

// Boot the app
await import('../src/main.js');
window.dispatchEvent(new window.Event('DOMContentLoaded'));
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
await new Promise(r => setTimeout(r, 50));

console.log('after boot — errors:', errors.length ? errors : 'none');

// Start a tournament the way clicking Start does
const startBtn = window.document.querySelector('#start-btn');
console.log('menu rendered, start button present:', !!startBtn);
if (startBtn) startBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));

console.log('after start — errors:', errors.length ? errors.slice(0,3) : 'none');

// Ready up: InstructionScreen polls isReadyPressed, which reads keydown codes.
for (const code of ['Space', 'Enter']) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));
}
await new Promise(r => setTimeout(r, 400));
console.log('instruction screen display:', window.document.querySelector('#instruction-screen')?.style.display);

// Advance frames
let frames = 0;
for (let i = 0; i < 30; i++) {
  const cbs = rafCbs; rafCbs = [];
  for (const cb of cbs) { try { cb(performance.now() + i * 16); frames++; } catch (e) { errors.push('raf: ' + e.stack); } }
  await new Promise(r => setTimeout(r, 20));
}
console.log('frames ticked:', frames, '| draw ops recorded:', drawn.length);

// ---- Assertions -------------------------------------------------------
assert.strictEqual(errors.length, 0, `no runtime errors expected, got: ${errors.slice(0, 2).join(' | ')}`);
assert.ok(frames > 0, 'the render loop should tick');
assert.ok(drawn.length > 500, `a live round should issue many draw calls, got ${drawn.length}`);

// ellipse() is used by the character renderer (shadow, eyes, highlight)
// and by nothing else in the hot path - so its presence proves characters
// are actually being drawn rather than a fallback shape.
const ellipses = drawn.filter((c) => c === 'ellipse').length;
assert.ok(ellipses > 50, `characters should be rendering (ellipse ops: ${ellipses})`);
console.log('character draw ops (ellipse):', ellipses);
const crash = window.document.querySelector('#crash-screen');
console.log('crash screen visible:', crash?.style.display);
if (crash && crash.style.display === 'flex') console.log('CRASH TEXT:', crash.textContent.slice(0, 600));
if (errors.length) { console.log('\n=== ERRORS ==='); errors.slice(0,3).forEach(e => console.log(e.slice(0,900))); }
console.log('\n✓ app boots, starts a round, and renders characters to the canvas');
