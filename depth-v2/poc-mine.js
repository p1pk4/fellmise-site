/* POC: Mine как маленькое путешествие с открытиями. Только превью
 * /depth-v2/?poc=mine; / и /ru/ этот модуль не грузят вовсе.
 *
 * Три открытия внутри одной сцены. Все три — то, что уже нарисовано в
 * принятой плите шахты: рыжая жила по косяку входа, вагонетка с рудой на
 * рельсах, тёмное устье с уходящими внутрь рельсами. Новых предметов, иконок
 * инвентаря и заглушек нет; выноска указывает на часть картины и движется
 * вместе с камерой (своего параллакса у предмета нет).
 *
 * Выноска вторична к основному тексту биома: маленькая точка, тонкая линия,
 * короткая метка и одна строка, без плашки. Одновременно — не больше одной.
 *
 * Копия — POC, финальный текст сверяется с GDD позже; только EN.
 */

// координаты — доли кадра плиты шахты 1.6:1 (assets/depth/hi/mine_plate.webp)
const DISCOVERIES = [
  // рыжая жила по правому косяку входа — открытая порода; подпись правее
  { id: 'ore', at: [0.12, 0.34], anchor: [0.703, 0.345], offset: [150, -70],
    headline: 'Ore vein', line: 'Deeper veins yield richer resources.' },
  // вагонетка с рудой на рельсах — добыча уже на пути наверх
  { id: 'extraction', at: [0.34, 0.56], anchor: [0.612, 0.625], offset: [170, -30],
    headline: 'Extraction', line: 'What you bring back feeds crafting and trade.' },
  // тёмное устье: рельсы уходят в глубину; подпись правее, над правым косяком
  { id: 'depth', at: [0.56, 0.78], anchor: [0.628, 0.47], offset: [230, -150],
    headline: 'Depth', line: 'The deeper you go, the greater the risk.' },
];
const FADE = 0.035;       // доля локального прогресса шахты на появление и уход

const CSS = `
.poc-disc { position: fixed; inset: 0; pointer-events: none; z-index: 40; }
.poc-disc svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.poc-disc line { stroke: rgba(246, 226, 186, .6); stroke-width: 1; }
.poc-disc circle.dot { fill: #f6e2ba; filter: drop-shadow(0 0 4px rgba(255, 190, 110, .8)); }
.poc-disc circle.ring { fill: none; stroke: rgba(246, 226, 186, .4); stroke-width: 1; }
.poc-disc .lab { position: absolute; left: 0; top: 0; max-width: 20rem; color: #eadcbc;
  text-shadow: 0 1px 10px rgba(0, 0, 0, .85), 0 0 2px rgba(0, 0, 0, .6); }
.poc-disc .lab--left { text-align: right; }
/* метка легче заголовка биома: мелкий разреженный капс, строка — кегль тела */
.poc-disc .lab b { display: block; font: 700 11px/1.2 Podkova, Georgia, serif; letter-spacing: .16em;
  text-transform: uppercase; color: #d9c69c; }
.poc-disc .lab span { display: block; margin-top: .3em; font: 500 clamp(13px, .82vw, 15px)/1.35 Vollkorn, Georgia, serif; }
.poc-badge { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 41; pointer-events: none;
  font: 600 11px/1 ui-monospace, monospace; letter-spacing: .08em; color: #8fc0ff;
  background: rgba(10, 20, 40, .55); padding: 6px 10px; border-radius: 3px; }
`;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function mountMinePoc(parent) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'poc-disc';
  root.innerHTML = '<svg aria-hidden="true"></svg>';
  parent.appendChild(root);
  const badge = document.createElement('div');
  badge.className = 'poc-badge';
  badge.textContent = 'POC · MINE DISCOVERIES · NOT FINAL';
  document.body.appendChild(badge);
  const svg = root.querySelector('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const items = DISCOVERIES.map((d) => {
    const g = document.createElementNS(NS, 'g');
    const line = document.createElementNS(NS, 'line');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('class', 'ring');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'dot'); dot.setAttribute('r', '2.6');
    g.append(line, ring, dot);
    svg.appendChild(g);
    const lab = document.createElement('div');
    lab.className = d.offset[0] < 0 ? 'lab lab--left' : 'lab';
    lab.innerHTML = `<b>${d.headline}</b><span>${d.line}</span>`;
    root.appendChild(lab);
    return { d, g, line, ring, dot, lab };
  });

  /* m — локальный прогресс шахты (0..1), el — слой, который сейчас
     показывает сцену шахты (окно предыдущей секции или своя плита). */
  return function update(m, el) {
    let rect = null, k = 1, ox = 0, oy = 0, Wr = 0, Hr = 0;
    if (el && !el.hidden) {
      rect = el.getBoundingClientRect();
      const W = innerWidth, H = innerHeight;
      Wr = Math.max(W, H * 1.6); Hr = Wr / 1.6; ox = (W - Wr) / 2; oy = (H - Hr) / 2;
      k = rect.width / W;
    }
    const project = ([u, v]) => [rect.left + (ox + u * Wr) * k, rect.top + (oy + v * Hr) * k];
    const W = innerWidth, H = innerHeight;
    for (const it of items) {
      const [a, z] = it.d.at;
      const o = m == null || !rect ? 0 : smooth(clamp01((m - a) / FADE)) * (1 - smooth(clamp01((m - (z - FADE)) / FADE)));
      it.g.style.opacity = String(o);
      it.lab.style.opacity = String(o);
      if (o <= 0) continue;
      const [x, y] = project(it.d.anchor);
      // подпись — справа от предмета со смещением, в пределах безопасной
      // зоны кадра; линия приходит к её левому краю и текст не пересекает
      const lw = it.lab.offsetWidth || 300, left = it.d.offset[0] < 0;
      const lx = Math.min(Math.max(left ? x + it.d.offset[0] - lw : x + it.d.offset[0], 0.04 * W), W - lw - 0.03 * W);
      const ly = Math.min(Math.max(y + it.d.offset[1], 0.12 * H), 0.84 * H);
      it.dot.setAttribute('cx', x); it.dot.setAttribute('cy', y);
      it.ring.setAttribute('cx', x); it.ring.setAttribute('cy', y); it.ring.setAttribute('r', '8');
      it.line.setAttribute('x1', x); it.line.setAttribute('y1', y);
      // линия к краю подписи, не через текст: слева — к левому краю, справа — под нижний угол
      it.line.setAttribute('x2', left ? lx + lw - 4 : lx - 10);
      it.line.setAttribute('y2', left ? ly + it.lab.offsetHeight + 6 : ly + 11);
      it.lab.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translateY(${((1 - o) * 3).toFixed(1)}px)`;
    }
  };
}
