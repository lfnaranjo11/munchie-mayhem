import { EXPRESSION } from './anim/VisualState.js';

/**
 * CharacterRenderer.js - draws one character, procedurally.
 *
 * ── THE SPRITE SEAM ──────────────────────────────────────────────────
 * This is the single file to replace when you move from procedural art to
 * drawn sprites or a skeletal runtime. Its whole public surface is:
 *
 *     drawCharacter(ctx, { x, y, radius, character, visual, flags })
 *
 * `visual` is a VisualState (squash, tilt, bob, blink, expression) and
 * `character` is a plain definition from config/characters.js. A sprite
 * implementation would take exactly the same arguments and use `visual`
 * to pick a frame and apply the same transform - so nothing upstream
 * (minigames, CanvasRenderer's dispatch, the camera) changes at all.
 *
 * Keeping the procedural version means characters cost zero asset load,
 * scale crisply to any resolution and DPI, and can be recoloured or
 * reshaped from config for A/B tests - which is worth a lot before you've
 * committed to an art style.
 */

/** Draws the character body, topping, face and any state badges. */
export function drawCharacter(ctx, opts) {
  const { x, y, radius, character, visual, flags = {} } = opts;
  const scale = visual ? visual.getScale() : { x: 1, y: 1 };
  const tilt = visual ? visual.tilt.value : 0;
  const bob = visual ? visual.bob : 0;
  const facing = visual ? visual.facingX : 1;
  const expression = visual ? visual.expression : EXPRESSION.NEUTRAL;
  const blink = visual ? visual.blinkAmount : 0;

  ctx.save();
  // Everything is drawn around a local origin so squash/tilt pivot at the
  // character's feet rather than its centre - pivoting at the centre makes
  // squash look like a resize; pivoting low makes it look like weight.
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);
  ctx.scale(scale.x, scale.y);

  drawShadow(ctx, radius);

  if (flags.onFire) drawFireAura(ctx, radius);

  drawBody(ctx, radius, character);
  drawAccent(ctx, radius, character);
  drawTopping(ctx, radius, character);
  drawFace(ctx, radius, expression, blink, facing);

  ctx.restore();

  // Badges are drawn OUTSIDE the squash transform so they don't deform
  // with the body - a stretched crown or a wobbling timer bar reads as a
  // bug rather than as animation.
  // A clear "this is you" marker. Essential on a small phone screen with
  // four similar-looking characters bouncing around - without it players
  // genuinely lose track of which one they control.
  if (flags.isSelf) drawSelfMarker(ctx, x, y + bob - radius - (flags.crowned ? 34 : 16), radius);
  if (flags.crowned) drawCrownOn(ctx, x, y + bob - radius - 12, radius * 0.55);
  if (typeof flags.timerFrac === 'number') drawTimerBar(ctx, x, y - radius - 22, radius, flags.timerFrac);
  if (flags.label) drawLabel(ctx, x, y + radius + 16, flags.label);
}

function drawShadow(ctx, radius) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, radius * 0.92, radius * 0.8, radius * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFireAura(ctx, radius) {
  // Two offset translucent blobs with a time-varying wobble - cheap, but
  // enough motion to read as flame rather than a static glow.
  const t = performance.now() / 120;
  ctx.save();
  for (let i = 0; i < 2; i++) {
    const wob = Math.sin(t + i * 1.7) * radius * 0.09;
    ctx.globalAlpha = 0.3 - i * 0.12;
    ctx.fillStyle = i === 0 ? '#ff8a3d' : '#ffd23f';
    ctx.beginPath();
    ctx.arc(wob, -radius * 0.1, radius * (1.28 + i * 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Body silhouettes. Each is drawn centred on (0,0) with the given radius. */
function drawBody(ctx, r, character) {
  const fill = character?.fill ?? '#f4c150';
  const shade = character?.shade ?? '#d8a63a';
  const body = character?.body ?? 'round';

  ctx.beginPath();
  switch (body) {
    case 'wedge': {
      // A rounded cheese-style wedge.
      const w = r * 1.15;
      ctx.moveTo(-w, r * 0.75);
      ctx.lineTo(w, r * 0.75);
      ctx.quadraticCurveTo(w * 1.05, -r * 0.2, 0, -r);
      ctx.quadraticCurveTo(-w * 1.05, -r * 0.2, -w, r * 0.75);
      break;
    }
    case 'tall':
      ctx.ellipse(0, 0, r * 0.82, r * 1.12, 0, 0, Math.PI * 2);
      break;
    case 'squat':
      ctx.ellipse(0, r * 0.08, r * 1.1, r * 0.9, 0, 0, Math.PI * 2);
      break;
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Bottom shading, clipped to the body, for a soft rounded read without
  // needing a gradient per frame.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(0, r * 1.05, r * 1.3, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Specular highlight - a small offset light patch. Does more for the
  // "soft toy" look than any other single detail here.
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.26, r * 0.17, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.strokeStyle = 'rgba(60,40,25,0.22)';
  ctx.stroke();
}

function drawAccent(ctx, r, character) {
  const accent = character?.accent ?? 'none';
  if (accent === 'none') return;
  ctx.save();
  if (accent === 'holes') {
    ctx.fillStyle = 'rgba(150,110,20,0.35)';
    for (const [ax, ay, ar] of [[-0.45, 0.3, 0.15], [0.4, 0.42, 0.11], [0.12, 0.62, 0.09]]) {
      ctx.beginPath();
      ctx.arc(ax * r, ay * r, ar * r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (accent === 'freckles') {
    ctx.fillStyle = 'rgba(90,60,30,0.3)';
    for (const [ax, ay] of [[-0.5, 0.12], [-0.35, 0.34], [0.48, 0.18], [0.33, 0.4]]) {
      ctx.beginPath();
      ctx.arc(ax * r, ay * r, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTopping(ctx, r, character) {
  const topping = character?.topping ?? 'none';
  if (topping === 'none') return;
  const color = character?.toppingColor ?? '#7fbf6a';
  ctx.save();
  ctx.fillStyle = color;

  if (topping === 'leaf') {
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 1.02, r * 0.3, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.22, -r * 1.02, r * 0.3, r * 0.14, 0.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (topping === 'sprout') {
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.9);
    ctx.quadraticCurveTo(r * 0.1, -r * 1.25, r * 0.3, -r * 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(r * 0.36, -r * 1.32, r * 0.16, r * 0.09, 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (topping === 'drip') {
    // A glossy topping that sits over the crown of the head.
    ctx.beginPath();
    ctx.moveTo(-r * 0.86, -r * 0.42);
    ctx.quadraticCurveTo(0, -r * 1.22, r * 0.86, -r * 0.42);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.2, r * 0.36, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.1, -r * 0.12, -r * 0.2, -r * 0.46);
    ctx.quadraticCurveTo(-r * 0.5, -r * 0.16, -r * 0.86, -r * 0.42);
    ctx.closePath();
    ctx.fill();
  } else if (topping === 'swirl') {
    for (const [sx, sy, sr] of [[-0.4, -0.85, 0.28], [0.4, -0.85, 0.28], [0, -1.05, 0.32]]) {
      ctx.beginPath();
      ctx.arc(sx * r, sy * r, sr * r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The face. Expressions change eye and mouth shape rather than swapping a
 * whole drawing, so they blend naturally with blinking and squash.
 */
function drawFace(ctx, r, expression, blink, facing) {
  const eyeX = r * 0.34;
  const eyeY = -r * 0.06;
  const eyeR = r * 0.14;
  // Eyes drift slightly toward the direction of travel - a subtle cue
  // that the character is looking where it's going.
  const gaze = facing * r * 0.04;

  ctx.save();
  ctx.fillStyle = '#2f2a26';

  const openness = 1 - blink * 0.92;

  if (expression === EXPRESSION.DIZZY) {
    // Dizzy: crossed-out eyes.
    ctx.strokeStyle = '#2f2a26';
    ctx.lineWidth = Math.max(2, r * 0.08);
    for (const sx of [-1, 1]) {
      const cx = sx * eyeX + gaze;
      ctx.beginPath();
      ctx.moveTo(cx - eyeR, eyeY - eyeR);
      ctx.lineTo(cx + eyeR, eyeY + eyeR);
      ctx.moveTo(cx + eyeR, eyeY - eyeR);
      ctx.lineTo(cx - eyeR, eyeY + eyeR);
      ctx.stroke();
    }
  } else if (expression === EXPRESSION.HAPPY) {
    // Happy: upward arcs.
    ctx.strokeStyle = '#2f2a26';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.lineCap = 'round';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * eyeX + gaze, eyeY + eyeR * 0.4, eyeR, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  } else {
    // Default: round eyes, vertically squashed by blink. Scared eyes are
    // wider, determined eyes narrower with a slight downward tilt.
    const wide = expression === EXPRESSION.SCARED ? 1.22 : 1;
    const narrow = expression === EXPRESSION.DETERMINED ? 0.72 : 1;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        sx * eyeX + gaze,
        eyeY,
        eyeR * wide,
        Math.max(0.06, eyeR * wide * openness * narrow),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    // Eye shine, skipped mid-blink so it doesn't float over closed eyes.
    if (openness > 0.5) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * eyeX + gaze + eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (expression === EXPRESSION.DETERMINED) {
      ctx.strokeStyle = '#2f2a26';
      ctx.lineWidth = Math.max(1.5, r * 0.07);
      ctx.lineCap = 'round';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * eyeX - eyeR * 1.1 + gaze, eyeY - eyeR * 1.5);
        ctx.lineTo(sx * eyeX + eyeR * 1.1 + gaze, eyeY - eyeR * 1.05);
        ctx.stroke();
      }
    }
  }

  // Mouth
  ctx.strokeStyle = '#2f2a26';
  ctx.lineWidth = Math.max(1.6, r * 0.07);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const mouthY = r * 0.34;
  if (expression === EXPRESSION.SCARED) {
    ctx.ellipse(gaze, mouthY, r * 0.12, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2f2a26';
    ctx.fill();
  } else if (expression === EXPRESSION.HAPPY) {
    ctx.arc(gaze, mouthY - r * 0.06, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else if (expression === EXPRESSION.DETERMINED) {
    ctx.moveTo(gaze - r * 0.16, mouthY);
    ctx.lineTo(gaze + r * 0.16, mouthY);
    ctx.stroke();
  } else {
    ctx.arc(gaze, mouthY - r * 0.04, r * 0.14, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** A bobbing chevron above your own character, plus a soft ring at its
 * feet. Two cues rather than one, because the chevron can be clipped at
 * the top edge of the arena. */
function drawSelfMarker(ctx, x, y, radius) {
  const t = performance.now() / 1000;
  const bob = Math.sin(t * 4) * 3;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(60,40,25,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + bob + 9);
  ctx.lineTo(x - 8, y + bob - 4);
  ctx.lineTo(x + 8, y + bob - 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 2.05 + 16, radius * 0.85, radius * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCrownOn(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = 'rgba(150,110,20,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.5);
  ctx.lineTo(x - r, y - r * 0.2);
  ctx.lineTo(x - r * 0.5, y + r * 0.15);
  ctx.lineTo(x, y - r * 0.6);
  ctx.lineTo(x + r * 0.5, y + r * 0.15);
  ctx.lineTo(x + r, y - r * 0.2);
  ctx.lineTo(x + r, y + r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTimerBar(ctx, x, y, r, frac) {
  ctx.save();
  const w = r * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - r, y, w, 6, 3);
  else ctx.rect(x - r, y, w, 6);
  ctx.fill();
  // Colour shifts toward red as the timer runs down, so urgency is
  // readable at a glance without looking at the bar's length.
  const clamped = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = clamped > 0.4 ? '#ffce54' : '#ff5f4d';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - r, y, w * clamped, 6, 3);
  else ctx.rect(x - r, y, w * clamped, 6);
  ctx.fill();
  ctx.restore();
}

function drawLabel(ctx, x, y, label) {
  ctx.save();
  ctx.font = '700 12px "Nunito", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(label, x, y);
  ctx.fillStyle = 'rgba(70,50,35,0.85)';
  ctx.fillText(label, x, y);
  ctx.restore();
}
