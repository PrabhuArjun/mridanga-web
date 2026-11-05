// Что показывает сцена с барабаном на событии звука: слог, какая рука (правая —
// справа от барабана, левая — слева, обе — вместе) и подробность схемы кисти.
// Чистые функции без DOM: их проверяет tests/drum-cue.test.js.
//
// Правила доверия (внутренние статусы данных ученику не показываются):
//  • схема кисти с пальцами — только когда подтверждены и сам удар (status = confirmed,
//    без расхождения о руке), и его приём (hand.status = confirmed); подтверждённого hand.status
//    при неподтверждённом ударе недостаточно;
//  • сторона (правая/левая рука) — только у подтверждённого удара без расхождения о руке;
//    у неподтверждённого сторона НЕ выводится, показывается общий значок удара;
//  • сторона известна, а пальцы нет — «только сторона», без пальцев;
//  • число пальцев (count) — цифра на общей кисти, без выбора пальцев;
//  • пауза — без рук.
import { eventCue } from './cue.js';
import { slotTimbre } from './display.js?v=0.3.0';

// A discrepancy about loudness does not contradict the documented hand.
// Unscoped, unknown and technique conflicts still suppress hand cues.
const handTrusted = (s) => s?.status === 'confirmed' && (!s.conflict || s.conflictScope === 'volume');
const SIDES = ['left', 'right'];

/**
 * Подсказка для практики: полная схема руки только у полностью подтверждённого события.
 * (Раньше жила в app.js; поведение прежнее, плюс составной удар должен быть сам подтверждён.)
 */
export function practiceCue(slot, ctx) {
  const { strokeMap } = ctx;
  const cue = eventCue(slot, ctx);
  if (cue.kind !== 'stroke') return cue;
  const disputed = cue.notes.some((n) => n.status !== 'confirmed');
  const parts = cue.parts.filter((p) => !disputed && p.hand.status === 'confirmed' && p.hand.shape !== 'unknown' &&
    handTrusted(strokeMap.get(p.strokeId)));
  const complete = parts.length === cue.parts.length &&
    cue.combos.every((c) => handTrusted(strokeMap.get(c.strokeId)) && c.hand?.status === 'confirmed');
  return { ...cue, parts: complete ? parts : [], combos: complete ? cue.combos : [] };
}

/**
 * @param {object} slot событие/поддоля из parsePattern или плана
 * @param {object} ctx как для eventCue: strokeMap, lanes, notes, tech
 * @returns {{
 *   kind: 'rest'|'stroke', label: string, accent: boolean, timbre: 'ringing'|'muted'|null,
 *   generic: boolean, hands: {left: object|null, right: object|null}, cue: object
 * }} hands.<сторона> = {side, strokeId, label, mode: 'detail'|'side', hand}; generic — сторона неизвестна
 */
export function drumCue(slot, ctx) {
  const { strokeMap } = ctx;
  const raw = eventCue(slot, ctx);
  if (raw.kind !== 'stroke') {
    return { kind: 'rest', label: raw.label, accent: false, timbre: null, generic: false, hands: { left: null, right: null }, cue: raw };
  }
  const detailed = practiceCue(slot, ctx);
  const showDetail = raw.parts.length > 0 && detailed.parts.length === raw.parts.length;
  const sides = raw.parts.map((p) => p.lane);
  const sideKnown = raw.parts.length > 0 &&
    raw.parts.every((p) => SIDES.includes(p.lane) && handTrusted(strokeMap.get(p.strokeId))) &&
    raw.combos.every((c) => handTrusted(strokeMap.get(c.strokeId))) &&
    new Set(sides).size === sides.length; // две роли на одной руке — не рисуем
  const hands = { left: null, right: null };
  if (sideKnown) {
    raw.parts.forEach((p, i) => {
      hands[p.lane] = {
        side: p.lane, strokeId: p.strokeId, label: p.label,
        mode: showDetail ? 'detail' : 'side', hand: showDetail ? detailed.parts[i].hand : null,
      };
    });
  }
  return {
    kind: 'stroke',
    label: raw.label,
    accent: raw.accent,
    timbre: slotTimbre(slot, strokeMap),
    generic: !sideKnown,
    hands,
    cue: detailed,
  };
}

/** Какая мембрана подсвечена: left, right, both, any (сторона неизвестна) или '' (пауза). */
export function hitOf(view) {
  if (!view || view.kind !== 'stroke') return '';
  if (view.generic) return 'any';
  return view.hands.left && view.hands.right ? 'both' : view.hands.left ? 'left' : 'right';
}

/** Краткая метка стороны для маленькой подсказки: «Л», «П», «Л+П» или пусто. */
export function sideMark(view) {
  const hit = hitOf(view);
  return hit === 'both' ? 'Л+П' : hit === 'left' ? 'Л' : hit === 'right' ? 'П' : '';
}
