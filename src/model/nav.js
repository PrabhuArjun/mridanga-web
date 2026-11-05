// Маршруты (#/…), разделы главного меню, путь «Главное меню › …» и цель кнопки
// «Вернуться назад». «Назад» ведёт на уровень выше по пути, а не по истории
// браузера: так кнопка никогда не уводит из приложения. Чистые функции без DOM.

/** Разделы главного меню в порядке плиток и нижней навигации. */
export const SECTIONS = Object.freeze([
  { id: 'practice', title: 'Практика', short: 'Практика', icon: 'play' },
  { id: 'theory', title: 'Теория', short: 'Теория', icon: 'book' },
  { id: 'strokes', title: 'Удары', short: 'Удары', icon: 'hand' },
  { id: 'progress', title: 'Прогресс', short: 'Прогресс', icon: 'chart' },
  { id: 'sound', title: 'Звук', short: 'Звук', icon: 'sound' },
  { id: 'about', title: 'О приложении', short: 'О прил.', icon: 'info' },
]);

/**
 * Нижняя навигация: «Меню» (главное меню) и четыре основных раздела. Семь пунктов на
 * телефоне в 320 px не помещаются без обрезанных подписей, поэтому «Звук» и «О приложении»
 * остаются на плитках главного меню — доступ к ним не потерян.
 */
export const BOTTOM_PRIMARY = Object.freeze(['practice', 'theory', 'strokes', 'progress']);

export const BOTTOM_TABS = Object.freeze([
  { id: 'home', title: 'Главное меню', short: 'Меню', icon: 'home' },
  ...SECTIONS.filter((s) => BOTTOM_PRIMARY.includes(s.id)),
]);

const PAGES = new Set(['practice', 'theory', 'strokes', 'progress', 'sound', 'about', 'lesson', 'editor', 'support']);

/**
 * Разобрать адрес. Неизвестный раздел — главное меню.
 * @param {string} hash location.hash
 * @returns {{page: string, a: string|null, b: string|null}}
 */
export function parseRoute(hash) {
  const raw = String(hash || '#/').replace(/^#/, '');
  const parts = raw.split('/').slice(1).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const [page = '', a = null, b = null] = parts;
  if (!PAGES.has(page)) return { page: 'home', a: null, b: null };
  return { page, a: a || null, b: b || null };
}

export function href(page, ...rest) {
  if (page === 'home') return '#/';
  const tail = rest.filter((x) => x !== null && x !== undefined && x !== '').map((x) => `/${encodeURIComponent(x)}`).join('');
  return `#/${page}${tail}`;
}

/** Раздел меню, к которому относится страница (для отметки в нижней навигации). */
export function sectionOf(page) {
  if (page === 'lesson') return 'practice';
  return SECTIONS.some((s) => s.id === page) ? page : null;
}

/** Пункты нижней панели для страницы: ссылка и отметка текущего раздела. */
export function bottomTabs(page) {
  const cur = sectionOf(page);
  return BOTTOM_TABS.map((t) => ({ ...t, href: href(t.id), current: t.id === cur }));
}

/**
 * Путь от главного меню до страницы: [{title, href}], последний — текущая страница.
 * @param {{page: string}} r маршрут
 * @param {{lessonTitle?: string, exerciseTitle?: string, lessonId?: string}} [names]
 */
export function breadcrumb(r, names = {}) {
  const home = { title: 'Главное меню', href: '#/' };
  if (r.page === 'home') return [home];
  if (r.page === 'lesson') {
    const trail = [home, { title: 'Практика', href: href('practice', names.lessonId) }];
    if (names.lessonTitle) trail.push({ title: names.lessonTitle, href: href('practice', names.lessonId) });
    trail.push({ title: names.exerciseTitle || 'Упражнение', href: null });
    return trail;
  }
  if (r.page === 'support') return [home, {title:'Техподдержка', href:null}];
  if (r.page === 'editor') return [home, { title: 'Для преподавателя', href: null }];
  // Раздел — один экран: выбранный урок/удар показан в пути, но «назад» из
  // раздела всегда ведёт в главное меню.
  const sec = SECTIONS.find((s) => s.id === r.page);
  const trail = [home, { title: sec?.title ?? '', href: null }];
  if (names.lessonTitle) trail.push({ title: names.lessonTitle, href: null });
  return trail;
}

/** Куда ведёт «Вернуться назад»: предыдущий пункт пути со ссылкой. */
export function backHref(trail) {
  for (let i = trail.length - 2; i >= 0; i--) if (trail[i].href) return trail[i].href;
  return '#/';
}
