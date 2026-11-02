// Достоверность записи по слоям. Подтверждение слогов (титры, речь) ничего не
// говорит о длительностях, раскладке по долям, выборе удара для слога и
// назначении рук — поэтому каждый слой оценивается отдельно. Чистые функции:
// их проверяют тесты, интерфейс только показывает результат.

/** От слабого к сильному: общий статус слоя — самый слабый из составляющих. */
export const STATUS_ORDER = Object.freeze(['unknown', 'teacher', 'note', 'probable', 'confirmed']);

export function weakestStatus(statuses) {
  const list = statuses.filter(Boolean);
  if (!list.length) return null;
  return list.reduce((a, b) => (rank(b) < rank(a) ? b : a));
}

function rank(s) {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? 0 : i; // незнакомый статус считаем самым слабым
}

/**
 * Сводка урока для каталога и заголовка: слоги и ритм отдельно.
 * Урок без упражнений оценивается одним статусом «содержание».
 */
export function lessonReliability(lesson) {
  const ex = lesson.exercises ?? [];
  if (!ex.length) return { content: lesson.status };
  return {
    syllables: weakestStatus(ex.map((e) => e.status)),
    rhythm: weakestStatus(ex.map((e) => e.rhythmStatus)),
  };
}

/**
 * Выбор удара для каждого слога упражнения.
 *  - lesson: удар объяснён в видео этого урока (есть источник с тем же видео);
 *  - transferred: удар объяснён в другом видео, здесь применён по аналогии — допущение;
 *  - card: описание самого удара не подтверждено (статус карточки);
 *  - conflict: в видео есть расхождение по этому удару;
 *  - alias: слог произносится иначе, чем называется техника (re=Те) — подтверждается
 *    только явной записью exercise.techniqueNotes с тем же alias.
 * @param {object} ex упражнение
 * @param {object} lesson урок (нужно lesson.video.id)
 * @param {object[]} slots результат parsePattern().slots
 * @param {Map<string, object>} strokeMap
 */
export function techniqueReliability(ex, lesson, slots, strokeMap) {
  const lessonVideo = lesson?.video?.id ?? null;
  const notes = ex.techniqueNotes ?? [];
  const items = [];
  const seen = new Set();
  for (const slot of slots) {
    if (slot.rest) continue;
    for (const id of slot.strokes) {
      const s = strokeMap.get(id);
      const alias = slot.label && slot.label !== s?.label ? `${id}=${slot.label}` : null;
      const key = alias ?? id;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(strokeItem(s, id, alias, slot.label, lessonVideo, notes));
    }
  }
  const noteStatuses = notes.filter((n) => !n.alias).map((n) => n.status);
  return {
    status: weakestStatus([...items.map((i) => i.status), ...noteStatuses]),
    items,
    notes: notes.filter((n) => !n.alias),
  };
}

function strokeItem(s, id, alias, aliasLabel, lessonVideo, notes) {
  const base = { id, label: aliasLabel ?? s?.label ?? id, technique: s?.label ?? id };
  if (!s) return { ...base, status: 'unknown', reason: 'card' };
  if (s.status !== 'confirmed') return { ...base, status: s.status, reason: 'card', source: s.sources?.[0] };
  if (s.conflict) return { ...base, status: 'teacher', reason: 'conflict', source: s.sources?.[0] };
  if (alias) {
    const n = notes.find((x) => x.alias === alias);
    return n
      ? { ...base, status: n.status, reason: 'alias', source: n, note: n.text }
      : { ...base, status: 'probable', reason: 'alias' };
  }
  const here = lessonVideo ? s.sources?.find((x) => x.video === lessonVideo) : null;
  if (here) return { ...base, status: 'confirmed', reason: 'lesson', source: here };
  return { ...base, status: 'probable', reason: 'transferred', source: s.sources?.[0] };
}

/** Назначение рук/мембран: статус линий, которые реально есть в записи. */
export function lanesReliability(lanes) {
  const real = lanes.filter((l) => l.id !== 'unknown');
  return { status: weakestStatus(real.map((l) => l.status)), lanes: real };
}
