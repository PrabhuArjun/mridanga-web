// Чистая математика расписания: какие удары и щелчки метронома попадают в окно
// времени [from, to). Web Audio планирует звук «наперёд» маленькими окнами
// (lookahead), а эта функция отвечает только за «что и когда» — её проверяют тесты.

/**
 * Режимы метронома. Подписи — для интерфейса; смысл задаётся полями.
 *  - beat: щелчок на каждую долю;
 *  - every: щелчок каждые N поддолей (N=1 — «каждый удар», N=2 — «через удар»,
 *    N=4 — «на 1 клик 4 удара» из рукописной методики).
 */
export const METRONOME_MODES = Object.freeze([
  { id: 'off', label: 'Без метронома' },
  { id: 'beat', label: 'На каждую долю' },
  { id: 'every1', label: 'Каждый удар', everySlots: 1 },
  { id: 'every2', label: 'Через удар', everySlots: 2 },
  { id: 'every4', label: '1 щелчок на 4 удара', everySlots: 4 },
]);

export function isClickSlot(ev, mode, slotsPerCycle) {
  if (mode.id === 'off') return false;
  if (mode.id === 'beat') return ev.beatStart;
  const n = mode.everySlots;
  // Если цикл не делится на N, считаем щелчки сквозь циклы, чтобы шаг не сбивался.
  const global = ev.cycle * slotsPerCycle + ev.slotIndex;
  return global % n === 0;
}

/**
 * События в окне [from, to) секунд от начала воспроизведения.
 * @param {{events: object[], cycleSec: number}} timeline цикл из buildCycleTimeline
 * @param {number} from
 * @param {number} to
 * @param {{metronomeId?: string, maxCycles?: number}} opts maxCycles — остановка после N циклов
 */
export function eventsInWindow(timeline, from, to, { metronomeId = 'off', maxCycles = Infinity } = {}) {
  const { events, cycleSec } = timeline;
  const out = [];
  if (!events.length || !(cycleSec > 0) || to <= from) return out;
  const mode = METRONOME_MODES.find((m) => m.id === metronomeId) ?? METRONOME_MODES[0];
  const firstCycle = Math.max(0, Math.floor(from / cycleSec));
  const lastCycle = Math.min(Math.floor(to / cycleSec), maxCycles - 1);
  for (let c = firstCycle; c <= lastCycle; c++) {
    for (const ev of events) {
      const t = c * cycleSec + ev.time;
      if (t < from - 1e-9 || t >= to - 1e-9) continue;
      const placed = { ...ev, cycle: c, at: t };
      placed.click = isClickSlot(placed, mode, events.length);
      placed.clickStrong = placed.click && ev.cycleStart;
      out.push(placed);
    }
  }
  return out;
}
