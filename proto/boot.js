/* Загрузка /proto/: живой мир грузится ТОЛЬКО в режиме live (решает mode.js).
   В статике three.js, раскладка и спрайты не запрашиваются вовсе. Любая ошибка
   живой загрузки — импорт модуля (нет WebGL, сломанный файл) или сборка сцены
   (main.js сообщает через FELLMISE_MODE.fail) — переводит страницу в статику. */
const M = window.FELLMISE_MODE;
if (M && M.mode === 'live') {
  import('./main.js').catch((e) => M.fail(e));
}
