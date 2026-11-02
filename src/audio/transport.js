// Единая временная модель прогона: план воспроизведения из участков с разным
// темпом. Из этого плана берут время и звук (Web Audio), и метроном, и лента
// подсказок, и счётчики — отдельного «визуального» таймера, который мог бы
// разойтись со звуком, нет. Чистые функции без DOM и Web Audio: их проверяют тесты.
//
// Время плана — секунды от начала прогона. Номер события seq сквозной:
// seq = cycle × поддолей_в_цикле + slotIndex; он не зависит от темпа, поэтому
// лента может показывать «следующие» события и до, и после смены темпа.
import { METRONOME_MODES, isClickSlot } from './scheduler.js';

const EPS = 1e-9;

/**
 * @param {{events: object[], cycleSec: number}} timeline цикл из buildCycleTimeline
 * @param {{maxCycles?: number, rate?: number}} [opts] rate — темп в ударах/мин (для записи прогресса)
 */
export function createPlan(timeline, { maxCycles = Infinity, rate = null } = {}) {
  return {
    slots: timeline.events.length,
    maxCycles,
    segments: [{ start: 0, fromCycle: 0, timeline, rate }],
  };
}

/** Конец плана в секундах (Infinity для «без остановки»). */
export function planEnd(plan) {
  if (!Number.isFinite(plan.maxCycles)) return Infinity;
  const seg = plan.segments[plan.segments.length - 1];
  return seg.start + (plan.maxCycles - seg.fromCycle) * seg.timeline.cycleSec;
}

function segmentEnd(plan, i) {
  const next = plan.segments[i + 1];
  return next ? next.start : planEnd(plan);
}

/**
 * Сменить темп с ближайшей границы цикла, которая ещё не запланирована.
 * Уже запланированные (и звучащие) события не меняются — поэтому нет ни
 * «хвоста» старого темпа после границы, ни двойного звучания.
 * Повторная смена до той же границы заменяет ожидающий участок.
 * @param {object} plan
 * @param {number} scheduledTo до какого времени плана звук уже запланирован
 * @param {{events: object[], cycleSec: number}} timeline новый цикл (тот же рисунок)
 * @param {number} rate
 * @returns {{plan: object, cycle: number, at: number} | null} null — до конца прогона границы нет
 */
export function retimePlan(plan, scheduledTo, timeline, rate) {
  if (timeline.events.length !== plan.slots) throw new RangeError('Смена темпа не меняет рисунок упражнения');
  if (scheduledTo <= EPS) {
    // Ничего ещё не запланировано: весь прогон идёт в новом темпе.
    return { plan: { ...plan, segments: [{ start: 0, fromCycle: 0, timeline, rate }] }, cycle: 0, at: 0 };
  }
  // Участки, которые ещё не начали планироваться, отбрасываем.
  const kept = plan.segments.filter((s) => s.start < scheduledTo - EPS);
  const last = kept[kept.length - 1];
  const cycle = last.fromCycle + Math.ceil((scheduledTo - last.start) / last.timeline.cycleSec - EPS);
  if (cycle >= plan.maxCycles) return null;
  const at = last.start + (cycle - last.fromCycle) * last.timeline.cycleSec;
  const segments = [...kept, { start: at, fromCycle: cycle, timeline, rate }];
  return { plan: { ...plan, segments }, cycle, at };
}

/**
 * События плана в окне [from, to). Те же поля, что у eventsInWindow, плюс
 * seq, rate и номер участка; cycle — сквозной номер цикла.
 */
export function eventsInPlan(plan, from, to, { metronomeId = 'off' } = {}) {
  const out = [];
  if (to <= from || !plan.slots) return out;
  const mode = METRONOME_MODES.find((m) => m.id === metronomeId) ?? METRONOME_MODES[0];
  plan.segments.forEach((seg, si) => {
    const segEnd = segmentEnd(plan, si);
    const lo = Math.max(from, seg.start);
    const hi = Math.min(to, segEnd);
    if (hi <= lo) return;
    const { events, cycleSec } = seg.timeline;
    const c0 = seg.fromCycle + Math.max(0, Math.floor((lo - seg.start) / cycleSec));
    const c1 = seg.fromCycle + Math.floor((hi - seg.start) / cycleSec);
    for (let c = c0; c <= c1 && c < plan.maxCycles; c++) {
      for (const ev of events) {
        const at = seg.start + (c - seg.fromCycle) * cycleSec + ev.time;
        if (at < lo - EPS || at >= hi - EPS) continue;
        const placed = { ...ev, cycle: c, at, seq: c * plan.slots + ev.slotIndex, rate: seg.rate, segment: si };
        placed.click = isClickSlot(placed, mode, plan.slots);
        placed.clickStrong = placed.click && ev.cycleStart;
        out.push(placed);
      }
    }
  });
  return out;
}

/**
 * Событие с номером seq: слот рисунка и время плана; null — такого события нет
 * (прогон закончился раньше).
 */
export function eventBySeq(plan, seq) {
  if (!Number.isInteger(seq) || seq < 0 || !plan.slots) return null;
  const cycle = Math.floor(seq / plan.slots);
  if (cycle >= plan.maxCycles) return null;
  let si = 0;
  for (let i = 0; i < plan.segments.length; i++) if (plan.segments[i].fromCycle <= cycle) si = i;
  const seg = plan.segments[si];
  const ev = seg.timeline.events[seq - cycle * plan.slots];
  return { ...ev, cycle, seq, at: seg.start + (cycle - seg.fromCycle) * seg.timeline.cycleSec + ev.time, rate: seg.rate, segment: si };
}

/**
 * Окно ленты: событие seq и соседние. Несуществующие (до начала или после
 * конца конечного прогона) не выдумываются — вместо них null.
 * @returns {{before: (object|null)[], current: object|null, after: (object|null)[]}}
 */
export function cueWindow(plan, seq, { before = 1, after = 3 } = {}) {
  const pick = (k) => eventBySeq(plan, k);
  return {
    before: Array.from({ length: before }, (_, i) => pick(seq - before + i)),
    current: pick(seq),
    after: Array.from({ length: after }, (_, i) => pick(seq + 1 + i)),
  };
}

/**
 * Дробная позиция ленты во времени плана t: seq текущего события + доля пути
 * до следующего. До старта — отрицательная (лента подъезжает к первому удару).
 */
export function positionAtTime(plan, t) {
  const first = eventBySeq(plan, 0);
  if (!first) return -1;
  if (t < first.at) return -1 + Math.max(0, 1 - (first.at - t) / first.duration);
  // Двоичный поиск по seq не нужен: в цикле десятки событий, перебор по циклам.
  let lo = 0;
  let hi = Number.isFinite(plan.maxCycles) ? plan.maxCycles * plan.slots - 1 : null;
  if (hi === null) {
    hi = 1;
    while ((eventBySeq(plan, hi)?.at ?? Infinity) <= t) hi *= 2;
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (eventBySeq(plan, mid).at <= t + EPS) lo = mid;
    else hi = mid - 1;
  }
  const cur = eventBySeq(plan, lo);
  const next = eventBySeq(plan, lo + 1);
  const span = next ? next.at - cur.at : cur.duration;
  return lo + Math.min(1, Math.max(0, (t - cur.at) / span));
}
