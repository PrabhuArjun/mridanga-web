// Схема кисти для подсказки приёма. Цвет — не единственный признак:
// названный палец закрашен и подписан, неназванные — контуром, предположение —
// штриховкой и пунктиром, неизвестный приём — знак вопроса без пальцев.
// Названное число пальцев («3 пальца») — крупной цифрой на ладони, без выбора
// конкретных пальцев: какие именно, в видео не сказано.
// Возвращает строку SVG; чистая функция (проверяется тестом без браузера).

// Правая кисть ладонью к зрителю, большой палец слева. Пальцы: x, верх, ширина, высота.
const W = 50;
const GEOM = {
  thumb: { x: 5.5, y: 29, w: 7, h: 15, rot: -38 },
  index: { x: 14, y: 9, w: 7, h: 23 },
  middle: { x: 21.8, y: 4, w: 7, h: 28 },
  ring: { x: 29.6, y: 7, w: 7, h: 25 },
  little: { x: 37.2, y: 14, w: 6.2, h: 18 },
};
export const FINGER_NAMES = Object.freeze({ thumb: 'большой', index: 'указательный', middle: 'средний', ring: 'безымянный', little: 'мизинец' });

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
  const dash = tentative || shape === 'count' || shape === 'unknown' ? ' stroke-dasharray="2.4 1.8"' : '';
  const fill = (lit) => (lit ? (tentative ? `url(#${id}p)` : 'currentColor') : 'none');
  const fingers = Object.entries(GEOM).map(([name, g]) => {
    const t = g.rot ? ` transform="rotate(${g.rot} ${g.x + g.w / 2} ${g.y + g.h})"` : '';
    return `<rect class="finger${on.has(name) ? ' on' : ''}" data-finger="${name}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h + 3}" rx="${g.w / 2}" fill="${fill(on.has(name))}"${dash}${t}/>`;
  }).join('');
  const palmLit = shape === 'slap';
  // Ладонь рисуется поверх оснований пальцев (неосвещённая — цветом фона, см. styles.css).
  const palm = `<path class="palm${palmLit ? ' on' : ''}" d="M13 31 H44 V45 Q44 55 33 55 H23 Q13 55 13 46 Z" fill="${fill(palmLit)}"${dash}/>`;
  let extra = '';
  if (shape === 'heel') {
    extra = `<ellipse class="heel on" cx="28.5" cy="51" rx="11" ry="3.6" fill="${fill(true)}"/>`
      + '<path class="bounce" d="M14 4 q3.5 -3.5 7 0 M30 2 q3.5 -3.5 7 0" fill="none"/>';
  } else if (shape === 'slap') {
    extra = '<path class="arrow" d="M47.5 4 V28 m-2.6 -3.2 l2.6 3.2 l2.6 -3.2" fill="none"/>';
  } else if (shape === 'count') {
    extra = `<text class="count" x="28.5" y="48" text-anchor="middle">${hand.count}${hand.then ? `→${hand.then}` : ''}</text>`;
  } else if (shape === 'unknown') {
    extra = '<text class="count" x="28.5" y="48" text-anchor="middle">?</text>';
  }
  const mirror = lane === 'left' ? ` transform="translate(${W} 0) scale(-1 1)"` : '';
  // Текст внутри зеркальной группы читался бы задом наперёд — выносим его наружу.
  const isText = extra.startsWith('<text');
  const title = handTitle(hand, lane);
  return `<svg class="hand${tentative ? ' tentative' : ''}" viewBox="0 0 ${W} 58" width="${size}" height="${Math.round(size * 58 / W)}" role="img" aria-label="${title}">
    <defs><pattern id="${id}p" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="currentColor" stroke-width="1.4"/></pattern></defs>
    <g${mirror}>${fingers}${palm}${isText ? '' : extra}</g>${isText ? extra : ''}</svg>`;
}

/** Подпись для экранного диктора и всплывающей подсказки. */
export function handTitle(hand, lane) {
  const side = lane === 'left' ? 'левая рука' : lane === 'right' ? 'правая рука' : 'рука не определена';
  const shape = hand?.shape ?? 'unknown';
  if (shape === 'fingers') return `${side}: ${hand.fingers.map((f) => FINGER_NAMES[f]).join(', ')}`;
  if (shape === 'count') return `${side}: ${hand.count} пальц.`;
  if (shape === 'slap') return `${side}: шлепок пальцами и ладонью`;
  if (shape === 'heel') return `${side}: основание ладони, пальцы отскакивают`;
  return `${side}`;
}

/** Названные пальцы словами («указательный») или пустая строка. */
export function fingerWords(hand) {
  return hand?.shape === 'fingers' ? hand.fingers.map((f) => FINGER_NAMES[f]).join(', ') : '';
}

/**
 * Общий значок удара по барабану: когда приём руки не подтверждён, ученик видит
 * слог и этот значок, без выдуманных пальцев.
 */
export function drumSvg({ size = 64, label = 'удар по барабану' } = {}) {
  return `<svg class="drum" viewBox="0 0 64 40" width="${size}" height="${Math.round(size * 40 / 64)}" role="img" aria-label="${label}">
    <path class="drum-body" d="M8 8 Q32 2 56 8 Q62 20 56 32 Q32 38 8 32 Q2 20 8 8 Z"/>
    <ellipse class="drum-head" cx="8" cy="20" rx="4.5" ry="12"/>
    <ellipse class="drum-head" cx="56" cy="20" rx="5.5" ry="12"/>
    <path class="drum-strap" d="M18 6.5 V33.5 M32 4.5 V35.5 M46 6.5 V33.5"/></svg>`;
}

/** Значок тембра: звонкий — расходящиеся дуги, глухой — придержанная точка, нейтральный — точка. */
export function timbreSvg(id, size = 24) {
  const body = id === 'ringing'
    ? '<circle cx="8" cy="12" r="3.4" class="t-fill"/><path d="M13 7.5 q3 4.5 0 9 M16.5 4.5 q5 7.5 0 15 M20 2 q6.5 10 0 20" class="t-line"/>'
    : id === 'muted'
      ? '<circle cx="9" cy="12" r="3.4" class="t-fill"/><path d="M15 5 V19 M19 5 V19" class="t-line"/>'
      : '<circle cx="12" cy="12" r="4" class="t-fill"/>';
  return `<svg class="timbre-ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
