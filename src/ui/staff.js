// Визуальная запись ритма в виде SVG-строки — аналог нотного стана:
// по горизонтали поддоли, по вертикали линии рук/мембран (из notation-config),
// значок удара — из strokes.json. Функция чистая: тесты проверяют разметку.
import { expandStroke, slotLabel } from '../model/notation.js';

const SLOT_W = 46;
const PAD_L = 12;
const TOP = 34;      // ось долей
const LANE_GAP = 40;
const LANE0 = 32;    // первая линия ниже оси, чтобы над ней поместился акцент

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Значок удара с центром в (x, y). */
export function glyphSvg(kind, x, y) {
  switch (kind) {
    case 'small':
      return `<circle class="g g-small" cx="${x}" cy="${y}" r="5.5"/>`;
    case 'open':
      return `<circle class="g g-open" cx="${x}" cy="${y}" r="9"/>`;
    case 'filled':
      return `<circle class="g g-filled" cx="${x}" cy="${y}" r="9"/>`;
    case 'hatched':
      return `<circle class="g g-hatched" cx="${x}" cy="${y}" r="10.5" fill="url(#hatch)"/>`;
    case 'ring':
      return `<circle class="g g-open" cx="${x}" cy="${y}" r="9.5"/><circle class="g g-open" cx="${x}" cy="${y}" r="4.5"/>`;
    case 'slide':
      return `<circle class="g g-open" cx="${x}" cy="${y - 4}" r="7"/><path class="g-line" d="M${x} ${y + 3} V${y + 14} M${x - 4} ${y + 10} L${x} ${y + 14} L${x + 4} ${y + 10}"/>`;
    default:
      return `<circle class="g g-unknown" cx="${x}" cy="${y}" r="9"/><text class="g-q" x="${x}" y="${y + 4}">?</text>`;
  }
}

/**
 * @param {object} p
 * @param {object[][]} p.beats результат parsePattern
 * @param {Map<string, object>} p.strokeMap
 * @param {{id: string, label: string}[]} p.lanes
 * @param {number[]} [p.grouping] группировка поддолей для скобок (иначе — по долям)
 * @param {string} [p.title] подпись для чтения с экрана
 */
export function renderStaff({ beats, strokeMap, lanes, grouping, title = 'Запись ритма' }) {
  const slots = beats.flat();
  const laneY = new Map(lanes.map((l, i) => [l.id, TOP + LANE0 + i * LANE_GAP]));
  const lastLaneY = TOP + LANE0 + (lanes.length - 1) * LANE_GAP;
  const sylY = lastLaneY + 30;
  const groupY = sylY + 14;
  const width = PAD_L * 2 + slots.length * SLOT_W;
  const height = groupY + 22;
  const xOf = (i) => PAD_L + i * SLOT_W + SLOT_W / 2;
  const out = [];

  out.push(`<svg class="staff" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}" xmlns="http://www.w3.org/2000/svg">`);
  out.push('<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-bg" width="5" height="5"/><line class="hatch-line" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>');

  // Подсветка текущей поддоли (класс переключает app.js).
  slots.forEach((_, i) => {
    out.push(`<rect class="slot-hl" data-slot="${i}" x="${PAD_L + i * SLOT_W + 1}" y="${TOP - 18}" width="${SLOT_W - 2}" height="${sylY - TOP + 26}" rx="6"/>`);
  });

  // Линии рук/мембран.
  for (const l of lanes) {
    const y = laneY.get(l.id);
    out.push(`<line class="lane lane-${esc(l.id)}" x1="${PAD_L}" y1="${y}" x2="${width - PAD_L}" y2="${y}"/>`);
  }

  // Ось: деления поддолей, номера долей, тактовые черты.
  let i = 0;
  beats.forEach((beat, b) => {
    const x0 = PAD_L + i * SLOT_W;
    out.push(`<line class="${b === 0 ? 'bar-cycle' : 'bar-beat'}" x1="${x0}" y1="${TOP - 6}" x2="${x0}" y2="${lastLaneY + 10}"/>`);
    out.push(`<text class="beat-num" x="${x0 + 5}" y="${TOP - 8}">${b + 1}</text>`);
    beat.forEach((_, s) => {
      out.push(`<line class="${s === 0 ? 'tick-beat' : 'tick-sub'}" x1="${xOf(i)}" y1="${TOP}" x2="${xOf(i)}" y2="${TOP + (s === 0 ? 8 : 5)}"/>`);
      i++;
    });
  });
  out.push(`<line class="bar-cycle" x1="${width - PAD_L}" y1="${TOP - 6}" x2="${width - PAD_L}" y2="${lastLaneY + 10}"/>`);
  out.push(`<line class="bar-cycle" x1="${width - PAD_L - 4}" y1="${TOP - 6}" x2="${width - PAD_L - 4}" y2="${lastLaneY + 10}"/>`);

  // Удары, паузы, акценты, слоги.
  slots.forEach((slot, idx) => {
    const x = xOf(idx);
    if (slot.rest) {
      const yMid = (TOP + LANE0 + lastLaneY) / 2;
      out.push(`<rect class="rest" x="${x - 8}" y="${yMid - 3}" width="16" height="6" rx="1"/>`);
    } else {
      for (const id of slot.strokes) {
        for (const part of expandStroke(id, strokeMap)) {
          const s = strokeMap.get(part);
          const y = laneY.get(s?.lane) ?? laneY.get('unknown') ?? lastLaneY;
          out.push(glyphSvg(s?.glyph, x, y));
        }
      }
    }
    if (slot.accent) out.push(`<text class="accent" x="${x}" y="${TOP + 17}">&gt;</text>`);
    out.push(`<text class="syl${slot.accent ? ' syl-acc' : ''}" data-slot="${idx}" x="${x}" y="${sylY}">${esc(slotLabel(slot, strokeMap))}</text>`);
  });

  // Скобки группировки (3+3+2 или по долям).
  const groups = grouping?.length ? grouping : beats.map((b) => b.length);
  let g0 = 0;
  for (const n of groups) {
    const xa = PAD_L + g0 * SLOT_W + 6;
    const xb = PAD_L + (g0 + n) * SLOT_W - 6;
    out.push(`<path class="group" d="M${xa} ${groupY - 4} V${groupY} H${xb} V${groupY - 4}"/>`);
    out.push(`<text class="group-n" x="${(xa + xb) / 2}" y="${groupY + 14}">${n}</text>`);
    g0 += n;
  }
  out.push('</svg>');
  return out.join('');
}
