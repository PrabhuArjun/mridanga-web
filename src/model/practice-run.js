// Учёт одного прогона упражнения: сколько ПОЛНЫХ циклов прозвучало и какая их
// часть уже записана в прогресс. Чистая логика без DOM и Web Audio — её
// проверяют тесты. Частичный цикл не засчитывается; повторная запись тех же
// циклов невозможна: take() отдаёт только то, что ещё не было отдано.

/**
 * Полных циклов к моменту события ev. Цикл полон, когда прозвучала его
 * последняя поддоля (так же считает счётчик «Циклы» на экране).
 * @param {{cycle: number, slotIndex: number} | null} last последнее прозвучавшее событие
 * @param {number} slotsPerCycle
 * @param {number} [maxCycles]
 */
export function completedCycles(last, slotsPerCycle, maxCycles = Infinity) {
  if (!last) return 0;
  const n = last.cycle + (last.slotIndex === slotsPerCycle - 1 ? 1 : 0);
  return Math.min(n, maxCycles);
}

/**
 * @param {object} p
 * @param {number} p.slotsPerCycle поддолей в цикле
 * @param {number} p.strokesPerCycle ударов (не пауз) в цикле
 * @param {number} p.rate темп, ударов в минуту
 * @param {number} [p.maxCycles]
 */
export function createPracticeRun({ slotsPerCycle, strokesPerCycle, rate, maxCycles = Infinity }) {
  let last = null;
  let heardStrokes = 0;
  let saved = 0;
  let closed = false;
  return {
    /** Прозвучала поддоля. После закрытия прогона события игнорируются. */
    step(ev) {
      if (closed) return;
      last = ev;
      if (!ev.rest) heardStrokes += 1;
    },
    /** Что видит ученик на счётчиках прямо сейчас (удары — включая неполный цикл). */
    get heard() {
      return { strokes: heardStrokes, cycles: completedCycles(last, slotsPerCycle, maxCycles) };
    },
    get closed() { return closed; },
    get rate() { return rate; },
    /**
     * Смена темпа на границе цикла. Сначала нужно забрать циклы старого темпа
     * (take), иначе они запишутся с новым темпом; поэтому несобранные — ошибка.
     */
    setRate(next) {
      if (completedCycles(last, slotsPerCycle, maxCycles) !== saved) {
        throw new Error('Перед сменой темпа заберите полные циклы прежнего темпа (take)');
      }
      rate = next;
    },
    /**
     * Ещё не записанные полные циклы (и их удары) или null, если записывать нечего.
     * close: true — прогон закончен, дальнейшие take() возвращают null.
     */
    take({ close = false } = {}) {
      if (closed) return null;
      const done = completedCycles(last, slotsPerCycle, maxCycles);
      const cycles = done - saved;
      saved = done;
      if (close) closed = true;
      return cycles > 0 ? { cycles, strokes: cycles * strokesPerCycle, rate } : null;
    },
  };
}
