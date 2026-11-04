// Озвучка объяснений: необязательный манифест content/narration.json и готовые
// MP3-файлы. Синтез речи браузера не используется никогда. Нет файла в
// манифесте — нет кнопки «Слушать»: ученик читает постраничный текст.
// Чистые функции без DOM: их проверяет tests/narration.test.js.

/** Допустимый путь записи: только свои файлы в content/audio/, только .mp3. */
export const NARRATION_SRC = /^content\/audio\/[A-Za-z0-9][A-Za-z0-9_-]*\.mp3$/;
export const NARRATION_SCOPES = Object.freeze(['lesson', 'about', 'stroke']);

/**
 * Манифест → Map «scope:id» → запись. Всё непонятное отбрасывается, а не ломает
 * приложение: неверный путь, неизвестная область, повтор ключа.
 * @param {unknown} raw содержимое narration.json (или null, если файла нет)
 * @returns {Map<string, {scope: string, id: string, src: string, title: string|null}>}
 */
export function normalizeNarration(raw) {
  const out = new Map();
  const tracks = raw && typeof raw === 'object' && Array.isArray(raw.tracks) ? raw.tracks : [];
  for (const t of tracks) {
    if (!t || typeof t !== 'object') continue;
    if (!NARRATION_SCOPES.includes(t.scope)) continue;
    if (typeof t.src !== 'string' || !NARRATION_SRC.test(t.src)) continue;
    const id = t.scope === 'about' ? 'about' : t.id;
    if (typeof id !== 'string' || !id) continue;
    const key = `${t.scope}:${id}`;
    if (out.has(key)) continue;
    out.set(key, { scope: t.scope, id, src: t.src, title: typeof t.title === 'string' ? t.title : null });
  }
  return out;
}

export function narrationFor(tracks, scope, id = scope) {
  return tracks?.get(`${scope}:${id}`) ?? null;
}

/**
 * Текст озвучки урока — только то, что уже есть в уроке: название, краткое
 * описание и шаги. Новых утверждений сюда не добавляется.
 * @param {{title: string, summary?: string, steps?: string[]}} lesson урок с написанием для экрана
 * @returns {string[]} абзацы
 */
export function narrationScript(lesson) {
  return [lesson.title, lesson.summary, ...(lesson.steps ?? [])]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
}
