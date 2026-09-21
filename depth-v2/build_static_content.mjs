/* Сборка статического HTML маршрута в страницы / , /ru/ и превью /depth-v2/.
 *
 *   node depth-v2/build_static_content.mjs          вписать
 *   node depth-v2/build_static_content.mjs --check  проверить; exit 1, если HTML
 *                                                    разошёлся с content-data.js
 *
 * Разметку даёт renderStatic из static-markup.js — та же функция, что и в
 * браузере, — а тексты она берёт из content-data.js. Вручную второго набора
 * EN/RU копий нет нигде: правка текста в content-data.js и повторная сборка
 * меняют все три страницы, а --check в CI не даёт забыть сборку.
 *
 * Вписывается только содержимое между маркерами; остальная страница не
 * трогается. Результат детерминирован: одинаковые данные — одинаковые байты.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStatic } from './static-markup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- STATIC_CONTENT_START -->';
const END = '<!-- STATIC_CONTENT_END -->';

// у продакшена ссылки языка — чистые адреса, у превью — запрос ?lang=
const PAGES = [
  { file: 'index.html',          locale: 'en', links: { en: '/', ru: '/ru/' } },
  { file: 'ru/index.html',       locale: 'ru', links: { en: '/', ru: '/ru/' } },
  { file: 'depth-v2/index.html', locale: 'en', links: { en: './', ru: './?lang=ru' } },
];

const check = process.argv.includes('--check');
const bad = [];

for (const p of PAGES) {
  const file = path.join(ROOT, p.file);
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < a) { bad.push(`${p.file}: нет маркеров ${START} … ${END}`); continue; }
  // переводы строк — как у самого файла: на Windows git может отдать страницу
  // в CRLF, и тогда --check не должен падать из-за одного лишь стиля строк
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const body = [START, `<div id="static" data-lang="${p.locale}">`, renderStatic(p.locale, p.links), '</div>', END]
    .join('\n').replace(/\n/g, eol);
  const next = html.slice(0, a) + body + html.slice(b + END.length);
  if (next === html) { console.log(`  ${p.file}: актуален`); continue; }
  if (check) bad.push(`${p.file}: статический HTML не совпадает с content-data.js — запустите сборку`);
  else { fs.writeFileSync(file, next, 'utf8'); console.log(`  ${p.file}: записан`); }
}

if (bad.length) {
  console.error('build_static_content: FAIL');
  for (const x of bad) console.error('  - ' + x);
  process.exit(1);
}
console.log(`build_static_content: ${check ? 'чисто' : 'готово'}`);
