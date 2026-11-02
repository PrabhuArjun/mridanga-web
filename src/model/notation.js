// Модель ритмической записи: разбор текстовой строки упражнения в доли и поддоли,
// проверка, построение временной шкалы. Чистые функции без DOM и Web Audio —
// их одинаково вызывают браузер и тесты (node --test).
//
// Принцип расширяемости: ни одно название удара не зашито в код. Слоги, руки,
// мембраны, символы и обозначения «на два / на три» приходят из content/*.json,
// поэтому преподаватель меняет их, не трогая этот файл.

/** Значения по умолчанию для служебных символов записи. */
export const DEFAULT_SYMBOLS = Object.freeze({
  rest: '-',      // пауза на одну поддолю
  accent: '>',    // префикс акцента: >Ke
  beat: '|',      // граница доли (необязательна: без неё строка режется по поддолям)
  together: '+',  // одновременные удары двумя руками: Ke+Na
  label: '=',     // произносимый слог отличается от техники: re=Те
});

/**
 * Индекс названий ударов: id и все aliases без учёта регистра → id.
 * Дубли — ошибка конфигурации, а не «последний победил».
 */
export function buildStrokeIndex(strokes) {
  const index = new Map();
  const errors = [];
  for (const s of strokes) {
    if (!s || typeof s.id !== 'string' || !s.id) {
      errors.push('Удар без id в словаре ударов');
      continue;
    }
    for (const name of [s.id, ...(s.aliases ?? [])]) {
      const key = String(name).trim().toLowerCase();
      if (!key) continue;
      const prev = index.get(key);
      if (prev && prev !== s.id) {
        errors.push(`Обозначение «${name}» указано и у «${prev}», и у «${s.id}»`);
      } else {
        index.set(key, s.id);
      }
    }
  }
  return { index, errors };
}

function tokenize(pattern, sym) {
  // Граница доли может стоять вплотную к слогу: «Te Re|Te Re».
  const spaced = pattern.split(sym.beat).join(` ${sym.beat} `);
  return spaced.split(/\s+/).filter(Boolean);
}

function parseSlot(token, strokeIndex, sym) {
  let raw = token;
  let accent = false;
  let label = null;
  const eq = raw.indexOf(sym.label);
  if (eq >= 0) {
    label = raw.slice(eq + sym.label.length);
    raw = raw.slice(0, eq);
    if (!label) return { error: `Пустой слог после «${sym.label}» в «${token}»` };
  }
  if (raw.startsWith(sym.accent)) {
    accent = true;
    raw = raw.slice(sym.accent.length);
  }
  if (raw === sym.rest) {
    return accent
      ? { error: `Акцент на паузе «${token}» не имеет смысла` }
      : { slot: { token, rest: true, accent: false, strokes: [], label } };
  }
  const parts = raw.split(sym.together).filter(Boolean);
  if (parts.length === 0) return { error: `Пустой удар «${token}»` };
  const ids = [];
  for (const p of parts) {
    const id = strokeIndex.get(p.toLowerCase());
    if (!id) return { error: `Неизвестный удар «${p}» в «${token}»` };
    ids.push(id);
  }
  return { slot: { token, rest: false, accent, strokes: ids, label } };
}

/**
 * Разбирает строку упражнения.
 * @param {string} pattern например "Te Re Te Re | Ta - Ta -"
 * @param {{strokes: object[], subdivision: number, symbols?: object}} opts
 * @returns {{beats: object[][], slots: object[], errors: string[]}}
 */
export function parsePattern(pattern, { strokes, subdivision, symbols } = {}) {
  const sym = { ...DEFAULT_SYMBOLS, ...(symbols ?? {}) };
  const errors = [];
  if (!Number.isInteger(subdivision) || subdivision < 1 || subdivision > 12) {
    return { beats: [], slots: [], errors: [`Число поддолей должно быть целым от 1 до 12, получено ${subdivision}`] };
  }
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { beats: [], slots: [], errors: ['Пустая запись упражнения'] };
  }
  const { index, errors: idxErrors } = buildStrokeIndex(strokes ?? []);
  errors.push(...idxErrors);

  const tokens = tokenize(pattern, sym);
  const explicitBeats = tokens.includes(sym.beat);
  const groups = [[]];
  for (const t of tokens) {
    if (t === sym.beat) {
      groups.push([]);
      continue;
    }
    const { slot, error } = parseSlot(t, index, sym);
    if (error) errors.push(error);
    else groups[groups.length - 1].push(slot);
  }

  let beats;
  if (explicitBeats) {
    beats = groups.filter((g, i) => g.length > 0 || (i > 0 && i < groups.length - 1));
    beats.forEach((g, i) => {
      if (g.length !== subdivision) {
        errors.push(`Доля ${i + 1}: ${g.length} поддол. вместо ${subdivision}`);
      }
    });
  } else {
    const flat = groups[0];
    if (flat.length % subdivision !== 0) {
      errors.push(`${flat.length} поддолей не делятся на доли по ${subdivision}`);
    }
    beats = [];
    for (let i = 0; i < flat.length; i += subdivision) beats.push(flat.slice(i, i + subdivision));
  }
  return { beats, slots: beats.flat(), errors };
}

/**
 * Удар → составляющие. «Так» = Та+Ке: рисуется на обеих линиях и звучит
 * обоими звуками, но считается одним ударом.
 */
export function expandStroke(id, strokeMap) {
  const s = strokeMap.get(id);
  if (!s?.combination?.length) return [id];
  return s.combination.flatMap((c) => (c === id ? [c] : expandStroke(c, strokeMap)));
}

/** Слог, который видит ученик: явная метка из записи или label удара(ов). */
export function slotLabel(slot, strokeMap, restLabel = '·') {
  if (slot.label) return slot.label;
  if (slot.rest) return restLabel;
  return slot.strokes.map((id) => strokeMap.get(id)?.label ?? id).join('+');
}

/**
 * Темп в ударах (поддолях) в минуту → доли в минуту для buildCycleTimeline.
 * В интерфейсе темп всегда в ударах/мин: так методика «метроном на каждый
 * удар, с 30 до 90» одинаково читается для любого упражнения.
 */
export function beatBpmFromStrokeRate(strokesPerMin, subdivision) {
  return strokesPerMin / subdivision;
}

/**
 * Временная шкала одного цикла: события на каждой поддоле.
 * @param {object[][]} beats результат parsePattern().beats
 * @param {number} bpm удары метронома (доли) в минуту
 */
export function buildCycleTimeline(beats, bpm) {
  if (!(bpm > 0)) throw new RangeError(`Темп должен быть положительным, получено ${bpm}`);
  const beatSec = 60 / bpm;
  const events = [];
  beats.forEach((beat, beatIndex) => {
    const slotSec = beatSec / beat.length;
    beat.forEach((slot, sub) => {
      events.push({
        time: beatIndex * beatSec + sub * slotSec,
        duration: slotSec,
        beatIndex,
        subIndex: sub,
        slotIndex: events.length,
        beatStart: sub === 0,
        cycleStart: beatIndex === 0 && sub === 0,
        ...slot,
      });
    });
  });
  return { events, cycleSec: beats.length * beatSec };
}

/** Сколько реальных ударов (не пауз) в цикле: одновременные Ke+Na — один удар. */
export function countStrokes(slots) {
  return slots.filter((s) => !s.rest).length;
}

/**
 * Позиция воспроизведения по прошедшему времени: номер цикла, поддоли и
 * сыгранных ударов. Используется и счётчиком, и подсветкой текущей ноты.
 */
export function positionAt(elapsedSec, timeline) {
  const { events, cycleSec } = timeline;
  if (elapsedSec < 0 || events.length === 0) {
    return { cycle: 0, slotIndex: -1, strokesDone: 0, cyclesDone: 0 };
  }
  const cycle = Math.floor(elapsedSec / cycleSec);
  const inCycle = elapsedSec - cycle * cycleSec;
  let slotIndex = 0;
  // Допуск в 1 мкс от ошибок округления на границе поддоли.
  for (let i = 0; i < events.length; i++) if (events[i].time <= inCycle + 1e-6) slotIndex = i;
  const perCycle = countStrokes(events);
  const doneInCycle = countStrokes(events.slice(0, slotIndex + 1));
  return { cycle, slotIndex, strokesDone: cycle * perCycle + doneInCycle, cyclesDone: cycle };
}

/** Лестница темпов «с 30 до 90 через 10»: включает обе границы. */
export function tempoLadder(from, to, step) {
  if (!(step > 0) || !(from > 0) || !(to >= from)) {
    throw new RangeError(`Неверная лестница темпов: ${from}→${to} шаг ${step}`);
  }
  const out = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}
