// Что видит ученик: короткие имена вкладок, написание названий и тембр удара.
// Данные (id, content/*.json) не меняются — здесь только отображение.
// Чистые функции без DOM: их проверяет tests/display.test.js.

/**
 * Написание названий для экрана. Ключ — как в данных, значение — как показывать.
 * Подтверждённое написание «Техай» координатор меняет ЗДЕСЬ, в одном месте:
 * id урока (tehai) и content/lessons.json остаются прежними.
 */
export const SPELLING = Object.freeze({
  'Техай': 'Техой',
});

/** Применить SPELLING к строке для экрана. */
export function spell(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [from, to] of Object.entries(SPELLING)) {
    if (from !== to) out = out.split(from).join(to);
  }
  return out;
}

/** Короткие имена вкладок уроков (id урока → имя). Без записи — заголовок до «:», «—» или «(». */
export const LESSON_TABS = Object.freeze({
  intro: 'Постановка рук',
  pm1: 'Мантра 1',
  pm2: 'Мантра 2',
  pm3: 'Мантра 3',
  pm4: 'Мантра 4',
  kaharba1: 'Кахарба',
  kaharba2: 'Кахарба 2',
  tehai: 'Техай',
  matan: 'Матан',
  daspere: 'Даспере',
  rela: 'Рела',
  lopha: 'Лопха',
  'matan-full': 'Матан полностью',
  'note-kenana': 'Ке На На Ко',
  care: 'Уход',
});

/** Короткие имена групп (модулей) для вкладок групп. */
export const MODULE_TABS = Object.freeze({
  m0: 'Начало',
  m1: 'Практические',
  m2: 'Игровые',
  m3: 'На два',
  m4: 'Полная Матан',
  m5: 'С метрономом',
  m6: 'Уход',
});

export function lessonTab(lesson) {
  const named = LESSON_TABS[lesson?.id];
  if (named) return spell(named);
  const t = String(lesson?.title ?? lesson?.id ?? '');
  return spell(t.split(/[:—(]/)[0].trim() || t);
}

export function moduleTab(module) {
  return spell(MODULE_TABS[module?.id] ?? String(module?.title ?? module?.id ?? ''));
}

/** Урок/модуль/упражнение с написанием для экрана. Исходный объект не меняется. */
export function spellLesson(lesson) {
  return {
    ...lesson,
    title: spell(lesson.title),
    summary: spell(lesson.summary),
    steps: (lesson.steps ?? []).map(spell),
    exercises: (lesson.exercises ?? []).map((e) => ({ ...e, title: spell(e.title) })),
  };
}

// ---------- тембр ----------
//
// «Звонкий»/«Глухой» выводятся только из явных слов описания подтверждённого
// удара или из смысла значка в notation-config («open» — «открытый звонкий удар»).
// Неподтверждённый удар, удар с расхождением в видео и всё без явного признака —
// null: на экране нейтральный значок «Удар», а не выдуманная категория.

/** Слова описания, означающие звонкий (открытый, резонирующий) звук. */
export const RINGING_WORDS = Object.freeze(['резонанс', 'открытый звук', 'звонк']);
/** Слова описания, означающие глухой (придержанный) звук. */
export const MUTED_WORDS = Object.freeze(['глух', 'придержанн']);
/** Значки, смысл которых в notation-config прямо называет звонкий звук. */
export const RINGING_GLYPHS = Object.freeze(['open']);

export const TIMBRES = Object.freeze({
  ringing: { id: 'ringing', word: 'Звонкий' },
  muted: { id: 'muted', word: 'Глухой' },
  neutral: { id: 'neutral', word: 'Удар' },
});

const trusted = (s) => Boolean(s) && s.status === 'confirmed' && !s.conflict;

/**
 * @param {object} stroke удар из strokes.json
 * @param {Map<string, object>} strokeMap
 * @returns {'ringing'|'muted'|null}
 */
export function strokeTimbre(stroke, strokeMap) {
  if (!trusted(stroke)) return null;
  if (stroke.combination?.length) {
    const parts = stroke.combination.map((id) => strokeTimbre(strokeMap.get(id), strokeMap));
    return parts.every((t) => t && t === parts[0]) ? parts[0] : null;
  }
  const text = String(stroke.technique ?? '').toLowerCase();
  if (MUTED_WORDS.some((w) => text.includes(w))) return 'muted';
  if (RINGING_GLYPHS.includes(stroke.glyph)) return 'ringing';
  if (RINGING_WORDS.some((w) => text.includes(w))) return 'ringing';
  return null;
}

/** Тембр поддоли записи: общий у всех её ударов, иначе null. Пауза — null. */
export function slotTimbre(slot, strokeMap) {
  if (!slot || slot.rest || !slot.strokes?.length) return null;
  const list = slot.strokes.map((id) => strokeTimbre(strokeMap.get(id), strokeMap));
  return list.every((t) => t && t === list[0]) ? list[0] : null;
}

/** Подпись тембра для экрана: null → нейтральное «Удар». */
export function timbreInfo(t) {
  return TIMBRES[t] ?? TIMBRES.neutral;
}

/**
 * Можно ли показать ученику схему кисти этого удара: описание подтверждено,
 * расхождений нет, приём назван. Иначе — только слог и общий значок.
 */
export function trustedHand(stroke) {
  if (!trusted(stroke)) return null;
  const h = stroke.hand;
  return h && h.status === 'confirmed' && h.shape !== 'unknown' ? h : null;
}

/** Подпись линии для экрана: короткая (П/Л) и полная (Правая · малая). */
export function laneWords(laneId) {
  if (laneId === 'right') return { short: 'Правая', long: 'Правая · малая' };
  if (laneId === 'left') return { short: 'Левая', long: 'Левая · большая' };
  return { short: '', long: '' };
}

/**
 * Разбить текст на страницы не длиннее max символов по границам предложений.
 * Длинное объяснение листается, а не обрезается.
 */
export function paginate(text, max = 160) {
  const src = String(text ?? '').trim();
  if (!src) return [];
  const sentences = (src.match(/[^.!?…]+[.!?…]*[»"]?\s*/g) ?? [src]).flatMap(sentence => {
    if (sentence.trim().length <= max) return [sentence];
    const parts = []; let line = '';
    for (const word of sentence.trim().split(/\s+/)) {
      if (line && (line + ' ' + word).length > max) { parts.push(line + ' '); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) parts.push(line + ' ');
    return parts;
  });
  const pages = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).trim().length > max) {
      pages.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) pages.push(cur.trim());
  return pages;
}
