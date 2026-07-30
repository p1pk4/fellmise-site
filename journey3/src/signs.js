/* Text type A — "in the world".
 *
 * Two of the five stops put their words on an object standing in the scene
 * instead of on a panel floating over it: the slogan on a plank sign at the
 * edge of the village road, and Vendetta on a stone slab in the spirit world.
 * The camera reads them head-on the way it reads a house.
 *
 * The board is drawn into a canvas — frame, planks or stone, then the text —
 * and used as the plane's texture, so the words are lit and fogged with the
 * rest of the scene rather than pasted on top of it. Type B (the cards in the
 * mine and the closing block at home) stays a DOM overlay; see style.css.
 *
 * The same words also stay in the DOM, demoted to a caption in live mode and
 * shown in full in the static fallback. There is one source of copy.
 */

const CREAM = '#fdf6e0';
const INK = '#1f2528';

/* Wait for the display face, but never block the scene on a webfont: after the
   deadline the board is drawn in the fallback stack rather than not at all. */
export async function fontsReady(ms = 2500) {
  if (!document.fonts) return;
  const wait = Promise.all([
    document.fonts.load('700 64px Podkova'),
    document.fonts.load('600 34px Vollkorn'),
  ]).catch(() => {});
  await Promise.race([wait, new Promise((r) => setTimeout(r, ms))]);
}

function face(px, weight, family, fallback) {
  const ok = document.fonts && document.fonts.check(`${weight} ${px}px ${family}`);
  return `${weight} ${px}px ${ok ? `${family}, ` : ''}${fallback}`;
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* Text is set at whatever size makes it fit the board — a long Russian slogan
   and a short English one must both fill the plank without spilling off it. */
function fitLines(ctx, text, maxWidth, maxHeight, from, to, lh, mk) {
  for (let px = from; px >= to; px -= 2) {
    ctx.font = mk(px);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length * px * lh <= maxHeight) return { px, lines };
  }
  ctx.font = mk(to);
  return { px: to, lines: wrap(ctx, text, maxWidth) };
}

function planks(ctx, x, y, w, h) {
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6f4526';
  for (let i = y + 26; i < y + h; i += 30) ctx.fillRect(x, i, w, 5);
  // a few darker strokes so the wood is not a flat swatch
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = INK;
  for (let i = 0; i < 26; i++) {
    const gy = y + 8 + ((i * 97) % (h - 16));
    ctx.fillRect(x + ((i * 211) % (w - 120)), gy, 60 + ((i * 37) % 90), 2);
  }
  ctx.globalAlpha = 1;
}

function stone(ctx, x, y, w, h) {
  ctx.fillStyle = '#5b6470';
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#8c97a5';
  for (let i = 0; i < 34; i++) {
    ctx.fillRect(x + ((i * 173) % (w - 90)), y + ((i * 251) % (h - 40)),
                 40 + ((i * 53) % 110), 3);
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = INK;
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(x + ((i * 311) % (w - 60)), y + ((i * 149) % (h - 30)), 26, 4);
  }
  ctx.globalAlpha = 1;
}

/* One board, ready to be used as a texture. `kind` picks the material; the two
   legs are part of the canvas so the sign stands on the ground instead of
   hovering. */
export function drawBoard({ kind, title, sub, width = 900, boardH = 700, legs = 260 }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = boardH + legs;
  const ctx = c.getContext('2d');

  const B = 14;                       // frame thickness, matching the DOM sign
  const legW = Math.round(width * 0.075);
  const legX = [Math.round(width * 0.24), Math.round(width * 0.76) - legW];
  if (legs > 0) {
    for (const lx of legX) {
      ctx.fillStyle = kind === 'stone' ? '#49525c' : '#6f4526';
      ctx.fillRect(lx, boardH - 20, legW, legs + 20);
      ctx.fillStyle = INK;
      ctx.fillRect(lx, boardH - 20, 5, legs + 20);
      ctx.fillRect(lx + legW - 5, boardH - 20, 5, legs + 20);
    }
  }

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, boardH);
  (kind === 'stone' ? stone : planks)(ctx, B, B, width - 2 * B, boardH - 2 * B);

  const pad = Math.round(width * 0.07);
  const maxW = width - 2 * pad;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const titleFont = (px) => face(px, 700, 'Podkova', 'Georgia, serif');
  const subFont = (px) => face(px, 600, 'Vollkorn', 'Georgia, serif');
  // The board is read from ten to twenty metres away, so the subtitle needs a
  // real share of the height, not a footnote's worth.
  const t = fitLines(ctx, title, maxW, boardH * 0.44, 88, 34, 1.18, titleFont);
  const s = sub ? fitLines(ctx, sub, maxW, boardH * 0.40, 56, 30, 1.28, subFont)
                : { px: 0, lines: [] };

  const titleH = t.lines.length * t.px * 1.18;
  const subH = s.lines.length * s.px * 1.28;
  const gap = sub ? Math.round(boardH * 0.11) : 0;   // rule plus air on both sides
  let y = Math.round((boardH - titleH - subH - gap) / 2);

  ctx.font = titleFont(t.px);
  for (const line of t.lines) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(line, width / 2 + 4, y + 5);
    ctx.fillStyle = CREAM;
    ctx.fillText(line, width / 2, y);
    y += t.px * 1.18;
  }

  if (sub) {
    y += Math.round(gap * 0.42);
    ctx.strokeStyle = 'rgba(253,246,224,.38)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    y += Math.round(gap * 0.58);
    ctx.font = subFont(s.px);
    for (const line of s.lines) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillText(line, width / 2 + 3, y + 4);
      ctx.fillStyle = CREAM;
      ctx.fillText(line, width / 2, y);
      y += s.px * 1.28;
    }
  }
  /* What the fit test reads: the box every glyph was drawn inside, against the
     box it had to stay inside. Reported rather than trusted, because the auto-
     fit has a floor — if a locale ever writes something long enough to hit it,
     the text would silently run off the plank. */
  c.__fit = {
    pad, width, boardH,
    titlePx: t.px, subPx: s.px,
    titleW: Math.max(...t.lines.map((l) => (ctx.font = titleFont(t.px), ctx.measureText(l).width))),
    subW: s.lines.length
      ? Math.max(...s.lines.map((l) => (ctx.font = subFont(s.px), ctx.measureText(l).width)))
      : 0,
    top: Math.round((boardH - titleH - subH - gap) / 2),
    bottom: y,
  };
  return c;
}
