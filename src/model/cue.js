// Подсказка для одного события ленты: слог, рука/мембрана и приём кисти.
// Подсказка берётся у КОНКРЕТНОГО удара события (id в записи), а не у слога:
// один слог в курсе играется разными приёмами (V02 01:02), а «Те», который
// играется как «Ре» (re=Те), показывает приём «Ре». Чистые функции без DOM.
import { slotLabel } from './notation.js';
import { weakestStatus } from './reliability.js';

export const FINGERS = Object.freeze(['thumb', 'index', 'middle', 'ring', 'little']);
export const HAND_SHAPES = Object.freeze(['fingers', 'count', 'slap', 'heel', 'together', 'unknown']);

/** Ключ пункта techniqueReliability: «re=Те» для подменённого слога, иначе id. */
export function techKey(item) {
  return item.label !== item.technique ? `${item.id}=${item.label}` : item.id;
}

function part(s, id, lanes) {
  const lane = lanes.find((l) => l.id === s?.lane);
  return {
    strokeId: id,
    label: s?.label ?? id,
    lane: s?.lane ?? 'unknown',
    laneStatus: lane?.status ?? null,
    hand: s?.hand ?? { shape: 'unknown', hint: 'Техника уточняется', status: 'unknown' },
  };
}

/**
 * @param {object} slot событие/поддоля из parsePattern или плана
 * @param {object} ctx
 * @param {Map<string, object>} ctx.strokeMap
 * @param {object[]} ctx.lanes линии из notation-config (со статусами)
 * @param {Map<string, object>} [ctx.tech] пункты techniqueReliability по techKey
 * @param {object[]} [ctx.notes] techniqueNotes упражнения (учитываются те, у которых slots включает slotIndex)
 */
export function eventCue(slot, { strokeMap, lanes, tech = new Map(), notes = [] }) {
  const slotNotes = notes.filter((n) => !n.alias && Array.isArray(n.slots) && n.slots.includes(slot.slotIndex));
  if (slot.rest) {
    return { kind: 'rest', label: 'пауза', accent: false, together: false, parts: [], status: null, notes: [], unknown: false };
  }
  const parts = [];
  const statuses = [];
  const combos = [];
  for (const id of slot.strokes) {
    const s = strokeMap.get(id);
    const key = slot.label && slot.label !== s?.label ? `${id}=${slot.label}` : id;
    const item = tech.get(key);
    if (item) statuses.push(item.status);
    if (s?.combination?.length) {
      // Составной удар: приём каждой руки — у составляющих, общий статус — у самого удара.
      combos.push({ strokeId: id, label: s.label, hand: s.hand ?? null });
      statuses.push(s.hand?.status ?? 'unknown');
      for (const c of s.combination) parts.push(part(strokeMap.get(c), c, lanes));
    } else {
      parts.push(part(s, id, lanes));
    }
  }
  for (const p of parts) statuses.push(p.hand.status ?? 'unknown');
  for (const n of slotNotes) statuses.push(n.status);
  return {
    kind: 'stroke',
    label: slotLabel(slot, strokeMap),
    accent: Boolean(slot.accent),
    together: parts.length > 1,
    parts,
    combos,
    notes: slotNotes,
    status: weakestStatus(statuses),
    unknown: parts.some((p) => p.hand.shape === 'unknown'),
  };
}

/** Удары, для которых подсказку нельзя дать без преподавателя: статус ниже «подтверждено» или пальцы не названы. */
export function strokesNeedingTeacher(strokes) {
  return strokes
    .map((s) => {
      const h = s.hand ?? {};
      const reasons = [];
      if (!s.hand || h.shape === 'unknown') reasons.push('приём не описан');
      if (h.status && h.status !== 'confirmed') reasons.push('подсказка не подтверждена');
      if (s.status !== 'confirmed') reasons.push('описание удара не подтверждено');
      if (s.conflict) reasons.push('расхождение в видео');
      if (h.shape === 'count') reasons.push('названо число пальцев, но не какие');
      return { id: s.id, label: s.label, reasons };
    })
    .filter((r) => r.reasons.length);
}
