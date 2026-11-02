// Прогресс ученика: чистые функции над простым объектом состояния.
// Важно: приложение НЕ слушает игру ученика. Всё, что здесь хранится, — это
// время прослушивания/игры под метроном и отметки самого ученика.

export const PROGRESS_VERSION = 1;

export function emptyProgress() {
  return { version: PROGRESS_VERSION, exercises: {}, lessons: {} };
}

/** Восстановление из хранилища: всё непонятное отбрасывается, а не ломает приложение. */
export function normalizeProgress(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== PROGRESS_VERSION) return emptyProgress();
  const out = emptyProgress();
  for (const [id, e] of Object.entries(raw.exercises ?? {})) {
    if (!e || typeof e !== 'object') continue;
    out.exercises[id] = {
      reps: nonNeg(e.reps),
      cycles: nonNeg(e.cycles),
      strokes: nonNeg(e.strokes),
      bestRate: nonNeg(e.bestRate),
      ladder: Object.fromEntries(Object.entries(e.ladder ?? {}).filter(([, v]) => v === true)),
      last: typeof e.last === 'string' ? e.last : null,
    };
  }
  for (const [id, done] of Object.entries(raw.lessons ?? {})) if (done === true) out.lessons[id] = true;
  return out;
}

function nonNeg(x) {
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

function ex(state, id) {
  return state.exercises[id] ?? { reps: 0, cycles: 0, strokes: 0, bestRate: 0, ladder: {}, last: null };
}

function withExercise(state, id, patch) {
  return { ...state, exercises: { ...state.exercises, [id]: { ...ex(state, id), ...patch } } };
}

/** Итог одного прогона: сколько циклов и ударов прозвучало и при каком темпе. */
export function recordRun(state, id, { cycles, strokes, rate, at }) {
  const e = ex(state, id);
  if (!(cycles > 0)) return state;
  return withExercise(state, id, {
    cycles: e.cycles + Math.floor(cycles),
    strokes: e.strokes + Math.floor(strokes),
    bestRate: Math.max(e.bestRate, Math.round(rate)),
    last: at,
  });
}

/** Ученик отметил: «повторение выполнено». */
export function markRep(state, id, at) {
  const e = ex(state, id);
  return withExercise(state, id, { reps: e.reps + 1, last: at });
}

export function toggleLadderStep(state, id, rate) {
  const e = ex(state, id);
  const ladder = { ...e.ladder };
  if (ladder[rate]) delete ladder[rate];
  else ladder[rate] = true;
  return withExercise(state, id, { ladder });
}

export function setLessonDone(state, lessonId, done) {
  const lessons = { ...state.lessons };
  if (done) lessons[lessonId] = true;
  else delete lessons[lessonId];
  return { ...state, lessons };
}

/**
 * Сводка по уроку: доля упражнений, по которым есть хотя бы одно отмеченное
 * повторение, и отметка «урок пройден». Это самооценка, а не проверка игры.
 */
export function lessonSummary(state, lesson) {
  const ids = lesson.exercises.map((e) => e.id);
  const practiced = ids.filter((id) => ex(state, id).reps > 0).length;
  return {
    total: ids.length,
    practiced,
    done: Boolean(state.lessons[lesson.id]),
    reps: ids.reduce((a, id) => a + ex(state, id).reps, 0),
  };
}

export function exerciseProgress(state, id) {
  return ex(state, id);
}
