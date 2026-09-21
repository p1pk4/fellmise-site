/* Depth Journey: камера всё время идёт внутрь.
 *
 * Появилась после замера, где сцена назначения на трёх переходах сначала
 * вырастала до 1.12–1.25, а потом возвращалась к 1.0 — камера «дышала» назад.
 * Тест проходит весь маршрут мелким шагом и собирает масштаб каждой сцены
 * назначения от первого появления до момента, когда она становится текущей
 * и ещё немного дальше. Масштаб не должен уменьшаться ни на одном шаге.
 * Заодно проверяется, что текст на экране никогда не бывает двойным.
 */
import { test, expect } from '@playwright/test';
import { stubExternal } from '../lib/browser.mjs';

const STEP = 0.004;

test('depth journey: destination scale never shrinks, one text at a time', async ({ browser, baseURL }) => {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, baseURL })).newPage();
  await stubExternal(page);
  await page.goto('/depth-v2/');
  await page.waitForFunction(() => window.__JOURNEY, null, { timeout: 60_000 });

  const samples = await page.evaluate(async (step) => {
    const num = (s) => { const m = s && s.match(/scale\(([\d.]+)\)/); return m ? +m[1] : null; };
    const out = [];
    for (let i = 0; i * step <= 1.00001; i++) {
      window.__JOURNEY.set(Math.min(1, i * step), { instant: true });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const kids = [...document.querySelectorAll('#stage > *')];
      const secs = [];
      for (const n of kids) {
        if (n.tagName === 'IMG' && !/_fg_/.test(n.src)) secs.push({ plate: n.hidden ? null : num(n.style.transform) });
        else if (n.classList.contains('holder')) secs.at(-1).next = n.hidden ? null : num(n.querySelector('img').style.transform);
      }
      out.push({ p: i * step, secs, texts: document.querySelectorAll('.beat.is-on').length });
    }
    return out;
  }, STEP);

  const problems = [];
  const n = samples[0].secs.length;
  for (let i = 0; i < n; i++) {
    // траектория назначения: входящая плита секции i, затем плита секции i+1
    const traj = [];
    for (const s of samples) {
      const cur = s.secs[i], nxt = s.secs[i + 1];
      if (cur.next != null) traj.push([s.p, cur.next]);
      else if (traj.length && nxt && nxt.plate != null && s.p <= traj[0][0] + 0.2) traj.push([s.p, nxt.plate]);
    }
    for (let k = 1; k < traj.length; k++) {
      if (traj[k][1] < traj[k - 1][1] - 1e-4) {
        problems.push(`section ${i}: scale ${traj[k - 1][1]} -> ${traj[k][1]} at p=${traj[k][0].toFixed(3)}`);
      }
    }
  }
  expect(problems, 'destination scene zooms back').toEqual([]);
  expect(Math.max(...samples.map((s) => s.texts)), 'texts on screen at once').toBeLessThanOrEqual(1);
  await page.context().close();
});
