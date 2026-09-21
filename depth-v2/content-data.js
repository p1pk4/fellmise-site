/* Данные контента маршрута — и только данные. Никакого DOM, location или
 * document: модуль импортируется и браузером, и Node-сборкой статического HTML
 * (build_static_content.mjs). Это единственный источник копирайта биомов —
 * живой маршрут, статическая версия и сгенерированный HTML корня читают его,
 * а не свои копии.
 *
 * Смысл полей (range, side, y, variant, mark, hero) описан в content.js,
 * который рисует по этим данным живой режим.
 */
export const BEATS = [
  {
    id: 'village',
    range: [0.030, 0.085],
    // низ слева: там тёмный дуб и забор переднего плана. По центру блок
    // ложился на красные крыши и светлую стену и переставал читаться
    side: 'left', y: 'lower', variant: 'quiet',
    en: {
      headline: 'A world that plays itself',
      body: 'The world does not wait for you. NPC adventurers raid dungeons, return with loot and end the day at the tavern.',
      statements: ['Life goes on without the player.'],
    },
    ru: {
      headline: 'Мир играет в себя',
      body: 'Мир не ждёт игрока. NPC-авантюристы ходят в подземелья, возвращаются с добычей и заканчивают день в таверне.',
      statements: ['Жизнь идёт и без игрока.'],
    },
  },
  {
    id: 'forest',
    range: [0.185, 0.240],
    side: 'right', y: 'lower', variant: 'air',
    en: {
      headline: 'Beyond the safe roads',
      body: 'The farther you travel from civilization, the greater the danger. At night, the wilderness changes — and some places reveal what daylight hides.',
      statements: ['Night changes the rules.'],
    },
    ru: {
      headline: 'За пределами безопасных дорог',
      body: 'Чем дальше от цивилизации, тем выше риск. Ночью дикая местность меняется — и некоторые места открывают то, что скрывает дневной свет.',
      statements: ['Ночь меняет правила.'],
    },
  },
  {
    id: 'mine',
    range: [0.350, 0.400],
    side: 'left', y: 'center', variant: 'grounded',
    en: {
      headline: 'Depth has a price',
      body: 'The deeper you go, the richer the resources — and the greater the risk. What you bring back feeds crafting and trade above ground.',
      statements: ['Better resources. Greater danger.'],
    },
    ru: {
      headline: 'У глубины есть цена',
      body: 'Чем глубже спускаешься, тем богаче ресурсы — и выше риск. Всё, что вынесешь наверх, идёт в ремесло и торговлю.',
      statements: ['Лучше ресурсы. Выше опасность.'],
    },
  },
  {
    id: 'threshold',
    // Самый крупный заголовок маршрута при полном отсутствии оформления:
    // стела остаётся абсолютным центром кадра
    range: [0.500, 0.535],
    side: 'left', y: 'lower', variant: 'bare', mark: 'spiral', hero: true,
    en: {
      headline: 'The dead see more.',
      body: 'Death does not remove you from the world. It reveals another layer of the same place.',
    },
    ru: {
      headline: 'Мёртвые видят больше.',
      body: 'Смерть не выводит тебя из мира. Она открывает другой слой того же места.',
    },
  },
  {
    id: 'core',
    range: [0.638, 0.716],
    side: 'right', y: 'lower', variant: 'caption', mark: 'spiral', hero: true,
    en: {
      headline: 'Death is a place',
      body: 'The dead can follow traces the living cannot see, uncover echoes of what happened here and find paths that exist only beyond death.',
      statements: ['Spirit Sight reveals what life conceals.', 'Some journeys begin after you die.'],
    },
    ru: {
      headline: 'Смерть — это место',
      body: 'Мёртвые видят следы, недоступные живым, находят отголоски произошедшего и пути, существующие только по ту сторону смерти.',
      statements: ['Духовное зрение открывает то, что скрыто от живых.', 'Некоторые пути начинаются после смерти.'],
    },
  },
  {
    id: 'home',
    range: [0.880, 1.000],
    side: 'left', y: 'lower', variant: 'air',
    en: {
      headline: 'A place to return to',
      body: 'Build a home that belongs only to you — part workshop, part storage, part sanctuary inside a shared world.',
      statements: ['Build. Craft. Store. Grow.'],
    },
    ru: {
      headline: 'Место, куда можно вернуться',
      body: 'Построй дом, который принадлежит только тебе — мастерскую, склад и убежище внутри общего мира.',
      statements: ['Строй. Создавай. Храни. Выращивай.'],
    },
  },
];

/* Служебные строки статической версии. Примечание — дословно строка .note
   прежних корневых страниц / и /ru/, не новый текст. */
export const STATIC_UI = {
  en: { other: 'RU', otherLabel: 'Русский', note: 'Fellmise is in early development. Everything here is still being built and will change.' },
  ru: { other: 'EN', otherLabel: 'English',  note: 'Игра в ранней разработке. Всё, что видишь, ещё поменяется.' },
};
