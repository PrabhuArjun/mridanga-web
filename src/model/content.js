// Проверка всего учебного контента — общая для редактора преподавателя и тестов.
import { parsePattern, buildStrokeIndex } from './notation.js';
import { FINGERS, HAND_SHAPES } from './cue.js';

/**
 * @param {{config: object, strokes: object[], modules: object[]}} c
 * @returns {string[]} понятные ошибки; пустой список — контент годен
 */
export function validateContent({ config, strokes, modules }) {
  const errors = [];
  if (!config || !Array.isArray(config.lanes) || !config.lanes.length) errors.push('Настройки: нет списка линий (lanes)');
  if (!Array.isArray(strokes) || !strokes.length) errors.push('Словарь ударов пуст');
  if (!Array.isArray(modules)) errors.push('Программа: нет списка модулей (modules)');
  if (errors.length) return errors;

  const statuses = new Set(Object.keys(config.statuses ?? {}));
  const lanes = new Set(config.lanes.map((l) => l.id));
  const feels = new Set((config.feels ?? []).map((f) => f.id));
  errors.push(...buildStrokeIndex(strokes).errors);
  const badStatus = (st) => statuses.size && st != null && !statuses.has(st);
  for (const f of config.feels ?? []) {
    if (badStatus(f.status) || badStatus(f.basis?.status)) errors.push(`Обозначение счёта «${f.id}»: неизвестный статус`);
  }

  const ids = new Set();
  for (const s of strokes) {
    if (ids.has(s.id)) errors.push(`Удар «${s.id}» описан дважды`);
    ids.add(s.id);
    if (s.lane !== 'both' && !lanes.has(s.lane)) errors.push(`Удар «${s.id}»: неизвестная линия «${s.lane}»`);
    if (statuses.size && !statuses.has(s.status)) errors.push(`Удар «${s.id}»: неизвестный статус «${s.status}»`);
    for (const c of s.combination ?? []) if (!strokes.some((x) => x.id === c)) errors.push(`Удар «${s.id}»: в составе неизвестный «${c}»`);
    if (s.hand) errors.push(...handErrors(s, badStatus));
  }

  const seenLessons = new Set();
  const seenExercises = new Set();
  for (const m of modules) {
    for (const l of m.lessons ?? []) {
      if (seenLessons.has(l.id)) errors.push(`Урок «${l.id}» встречается дважды`);
      seenLessons.add(l.id);
      if (l.feel && !feels.has(l.feel)) errors.push(`Урок «${l.id}»: неизвестное обозначение счёта «${l.feel}»`);
      for (const e of l.exercises ?? []) {
        // id упражнения — ключ прогресса ученика, поэтому он уникален во всей программе.
        if (seenExercises.has(e.id)) errors.push(`Упражнение «${e.id}» встречается дважды`);
        seenExercises.add(e.id);
        const r = parsePattern(e.pattern, { strokes, subdivision: e.subdivision, symbols: config.symbols });
        for (const err of r.errors) errors.push(`«${l.title}» / «${e.title}»: ${err}`);
        for (const [what, st] of [['слоги', e.status], ['ритм', e.rhythmStatus], ...(e.techniqueNotes ?? []).map((n) => ['техника', n.status])]) {
          if (badStatus(st)) errors.push(`«${e.title}»: неизвестный статус «${st}» (${what})`);
        }
        for (const n of e.techniqueNotes ?? []) {
          if (n.slots && !(Array.isArray(n.slots) && n.slots.every((i) => Number.isInteger(i) && i >= 0 && i < r.slots.length))) {
            errors.push(`«${e.title}»: заметка о технике ссылается на несуществующую поддолю`);
          }
        }
        if (e.grouping && e.grouping.reduce((a, b) => a + b, 0) !== r.slots.length) {
          errors.push(`«${e.title}»: группировка ${e.grouping.join('+')} не равна числу поддолей ${r.slots.length}`);
        }
      }
    }
  }
  return errors;
}

/** Ограничения видимой подписи на карточке ленты (проверены в браузере при 320/375 px). */
export const LANE_HINT = Object.freeze({ chars: 33, word: 10 });

/** Подсказка кисти: пальцы называются только явно, у составного удара — свой статус. */
function handErrors(s, badStatus) {
  const h = s.hand;
  const out = [];
  const where = `Удар «${s.id}», подсказка кисти`;
  if (!HAND_SHAPES.includes(h.shape)) out.push(`${where}: неизвестная форма «${h.shape}»`);
  if (!h.hint) out.push(`${where}: нет подписи`);
  // На карточке ленты видна краткая подпись (или полная, если краткой нет): она должна
  // помещаться в узкую карточку без обрезки — не длиннее LANE_HINT.chars и без слов длиннее LANE_HINT.word.
  const visible = h.short ?? h.hint ?? '';
  if (h.short !== undefined && !String(h.short).trim()) out.push(`${where}: пустая краткая подпись`);
  if (visible.length > LANE_HINT.chars || visible.split(/\s+/).some((w) => w.length > LANE_HINT.word)) {
    out.push(`${where}: подпись на ленте «${visible}» не помещается в карточку — добавьте краткую (short) до ${LANE_HINT.chars} знаков, слова до ${LANE_HINT.word}`);
  }
  if (badStatus(h.status) || !h.status) out.push(`${where}: неизвестный статус «${h.status}»`);
  if (h.shape === 'fingers' && !(Array.isArray(h.fingers) && h.fingers.length && h.fingers.every((f) => FINGERS.includes(f)))) {
    out.push(`${where}: пальцы должны быть из списка ${FINGERS.join(', ')}`);
  }
  if (h.shape !== 'fingers' && h.fingers) out.push(`${where}: пальцы указаны, а форма — «${h.shape}»`);
  if (h.shape === 'count' && !(Number.isInteger(h.count) && h.count >= 1 && h.count <= 5)) out.push(`${where}: число пальцев от 1 до 5`);
  if (h.shape === 'together' && !s.combination?.length) out.push(`${where}: «одновременно» только у составного удара`);
  if (s.combination?.length && h.shape !== 'together') out.push(`${where}: у составного удара форма «together»`);
  if (h.shape === 'unknown' && h.status === 'confirmed') out.push(`${where}: неизвестный приём не может быть подтверждён`);
  if (!h.source?.video || !/^\d{2}:\d{2}$/.test(h.source.t ?? '')) out.push(`${where}: нужен источник с таймкодом`);
  return out;
}
