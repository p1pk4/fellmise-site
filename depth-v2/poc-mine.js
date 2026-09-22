/* POC: Mine как маленькое путешествие с открытиями. Только превью
 * /depth-v2/?poc=mine; / и /ru/ этот модуль не грузят вовсе.
 *
 * Три открытия внутри одной сцены. Все три — то, что уже нарисовано в
 * принятой плите шахты: рыжая жила по косяку входа, вагонетка с рудой на
 * рельсах, тёмное устье с уходящими внутрь рельсами. Новых предметов, иконок
 * инвентаря и заглушек нет; выноска указывает на часть картины и движется
 * вместе с камерой (своего параллакса у предмета нет).
 *
 * Выноска вторична к основному тексту биома: медная точка на предмете,
 * линия 1 px, метка и одна строка; под текстом — мягкая растворяющаяся тень,
 * без плашки и рамки. Одновременно — не больше одной.
 *
 * Копия — POC, финальный текст сверяется с GDD позже; только EN.
 */

// координаты — доли кадра плиты шахты 1.6:1 (assets/depth/hi/mine_plate.webp)
const DISCOVERIES = [
  // рыжая жила по внутренней кромке правого косяка (самый насыщенный рыжий в плите)
  { id: 'ore', at: [0.12, 0.34], anchor: [0.696, 0.57], offset: [150, -110],
    headline: 'Ore vein', line: 'Deeper veins yield richer resources.' },
  // вагонетка с рудой на рельсах — добыча уже на пути наверх
  { id: 'extraction', at: [0.34, 0.56], anchor: [0.612, 0.625], offset: [235, -40],
    headline: 'Extraction', line: 'What you bring back feeds crafting and trade.' },
  // тёмное устье: рельсы уходят в глубину; подпись правее, над правым косяком
  { id: 'depth', at: [0.56, 0.78], anchor: [0.628, 0.47], offset: [230, -150],
    headline: 'Depth', line: 'The deeper you go, the greater the risk.' },
];
const FADE = 0.035;       // доля локального прогресса шахты на появление и уход

const CSS = `
.poc-disc { position: fixed; inset: 0; pointer-events: none; z-index: 40; }
.poc-disc svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
/* тёплая медь из палитры Fellmise, умеренная непрозрачность; без свечения */
.poc-disc line { stroke: rgba(207, 164, 116, .75); stroke-width: 1; }
.poc-disc circle.dot { fill: rgba(231, 185, 153, .92); }
.poc-disc .lab { position: absolute; left: 0; top: 0; max-width: 21rem; color: #eadcbc; }
/* локальная тень под текстом: растворяется к краям, границы не видно */
.poc-disc .lab::before { content: ''; position: absolute; inset: -30px -46px -30px -40px; z-index: -1;
  background: radial-gradient(closest-side, rgba(10, 11, 12, .5), rgba(10, 11, 12, .28) 55%, transparent); }
.poc-disc .lab--left { text-align: right; }
/* метка читается сразу, но заметно слабее заголовка биома */
.poc-disc .lab b { display: block; font: 700 clamp(16px, .99vw, 20px)/1 Podkova, Georgia, serif; letter-spacing: .05em;
  text-transform: uppercase; color: #e7b999; text-shadow: 0 1px 8px rgba(0, 0, 0, .6); }
.poc-disc .lab span { display: block; margin-top: .45em; font: 500 clamp(14px, .81vw, 16px)/1.35 Vollkorn, Georgia, serif;
  text-shadow: 0 1px 8px rgba(0, 0, 0, .7); }
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
  const svg = root.querySelector('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const items = DISCOVERIES.map((d) => {
    const g = document.createElementNS(NS, 'g');
    const line = document.createElementNS(NS, 'line');
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'dot'); dot.setAttribute('r', '2.75');
    g.append(line, dot);
    svg.appendChild(g);
    const lab = document.createElement('div');
    lab.className = d.offset[0] < 0 ? 'lab lab--left' : 'lab';
    lab.innerHTML = `<b>${d.headline}</b><span>${d.line}</span>`;
    root.appendChild(lab);
    return { d, g, line, dot, lab };
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
      it.line.setAttribute('x1', x); it.line.setAttribute('y1', y);
      // линия к краю подписи, не через текст: слева — к левому краю, справа — под нижний угол
      it.line.setAttribute('x2', left ? lx + lw - 4 : lx - 10);
      it.line.setAttribute('y2', left ? ly + it.lab.offsetHeight + 6 : ly + 11);
      it.lab.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px) translateY(${((1 - o) * 3).toFixed(1)}px)`;
    }
  };
}
