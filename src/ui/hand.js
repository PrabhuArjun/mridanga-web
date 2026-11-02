// Простая схема кисти для подсказки приёма. Цвет — не единственный признак:
// названный палец закрашен и подписан, неназванные — контуром, предположение —
// штриховкой и пунктиром, неизвестный приём — знак вопроса без пальцев.
// Возвращает строку SVG; чистая функция (проверяется тестом без браузера).

// Пальцы: x, верх, ширина. Ладонь — снизу.
const GEOM = {
  thumb: { x: 3, y: 24, w: 6, h: 12, rot: -35 },
  index: { x: 11, y: 7, w: 5.5, h: 17 },
  middle: { x: 17.5, y: 4, w: 5.5, h: 20 },
  ring: { x: 24, y: 6, w: 5.5, h: 18 },
  little: { x: 30, y: 11, w: 5, h: 13 },
};
const NAMES = { thumb: 'большой', index: 'указательный', middle: 'средний', ring: 'безымянный', little: 'мизинец' };

let uid = 0;

/**
 * @param {object} hand подсказка удара (strokes.json → hand)
 * @param {{lane?: string, tentative?: boolean, size?: number}} [opts]
 *   lane: 'left' — схема зеркалится; tentative — нарисовать как предположение
 */
export function handSvg(hand, { lane = 'right', tentative = false, size = 40 } = {}) {
  const id = `h${++uid}`;
  const shape = hand?.shape ?? 'unknown';
  const on = new Set(shape === 'fingers' ? hand.fingers : shape === 'slap' ? Object.keys(GEOM).filter((f) => f !== 'thumb') : []);
  const dash = tentative || shape === 'count' || shape === 'unknown' ? ' stroke-dasharray="2 1.6"' : '';
  const fill = (lit) => (lit ? (tentative ? `url(#${id}p)` : 'currentColor') : 'none');
  const fingers = Object.entries(GEOM).map(([name, g]) => {
    const t = g.rot ? ` transform="rotate(${g.rot} ${g.x + g.w / 2} ${g.y + g.h})"` : '';
    return `<rect class="finger${on.has(name) ? ' on' : ''}" data-finger="${name}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h + 2}" rx="${g.w / 2}" fill="${fill(on.has(name))}"${dash}${t}/>`;
  }).join('');
  const palmLit = shape === 'slap';
  const palm = `<path class="palm" d="M10 24 H36 V36 Q36 43 28 43 H17 Q10 43 10 36 Z" fill="${fill(palmLit)}"${dash}/>`;
  let extra = '';
  if (shape === 'heel') {
    extra = `<ellipse class="heel on" cx="23" cy="40" rx="9" ry="3.2" fill="${fill(true)}"/>`
      + '<path class="bounce" d="M13 4 q3 -3 6 0 M26 3 q3 -3 6 0" fill="none"/>';
  } else if (shape === 'slap') {
    extra = '<path class="arrow" d="M40 6 V30 m-2.5 -3 l2.5 3 l2.5 -3" fill="none"/>';
  } else if (shape === 'count') {
    extra = `<text class="count" x="23" y="37" text-anchor="middle">${hand.count}${hand.then ? `→${hand.then}` : ''}</text>`;
  } else if (shape === 'unknown') {
    extra = '<text class="count" x="23" y="38" text-anchor="middle">?</text>';
  }
  const mirror = lane === 'left' ? ' transform="translate(46 0) scale(-1 1)"' : '';
  // Текст внутри зеркальной группы читался бы задом наперёд — выносим его наружу.
  const isText = extra.startsWith('<text');
  const title = handTitle(hand, lane);
  return `<svg class="hand${tentative ? ' tentative' : ''}" viewBox="0 0 46 46" width="${size}" height="${size}" role="img" aria-label="${title}">
    <defs><pattern id="${id}p" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="currentColor" stroke-width="1.4"/></pattern></defs>
    <g${mirror}>${fingers}${palm}${isText ? '' : extra}</g>${isText ? extra : ''}</svg>`;
}

/** Подпись для экранного диктора и всплывающей подсказки. */
export function handTitle(hand, lane) {
  const side = lane === 'left' ? 'левая рука' : lane === 'right' ? 'правая рука' : 'рука не определена';
  const shape = hand?.shape ?? 'unknown';
  if (shape === 'fingers') return `${side}: ${hand.fingers.map((f) => NAMES[f]).join(', ')}`;
  if (shape === 'count') return `${side}: ${hand.count} пальц., какие — не названо`;
  if (shape === 'slap') return `${side}: шлепок пальцами и ладонью`;
  if (shape === 'heel') return `${side}: основание ладони, пальцы отскакивают`;
  return `${side}: приём уточняется`;
}
