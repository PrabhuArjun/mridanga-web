// Схема кисти для подсказки приёма. Цвет — не единственный признак:
//  • названный палец — штриховка, жирный контур и круг на кончике; если он один,
//    он отведён в сторону от сжатых (укороченных) неназванных пальцев;
//  • шлепок — кончики четырёх пальцев (метка 1), затем ладонь (метка 2);
//  • основание ладони — штрихованный овал у запястья, пальцы отскакивают;
//  • названное число пальцев («3 пальца») — крупной цифрой на ладони и пунктиром, без
//    выбора конкретных пальцев: какие именно, в видео не сказано;
//  • «только сторона» — пустой контур кисти без отмеченных пальцев;
//  • тембр — отдельный значок в углу, и сплошная заливка ладони у глухого звука. Место контакта
//    показано отдельно, штриховкой и точками.
// Возвращает строку SVG; чистая функция (проверяется тестом без браузера).

// Правая кисть ладонью к зрителю, большой палец слева. Пальцы: x, верх, ширина, высота.
const W = 50;
const GEOM = {
  thumb: { x: 5.5, y: 29, w: 7, h: 15, rot: -38 },
  index: { x: 14, y: 9, w: 7, h: 23, rot: 0 },
  middle: { x: 21.8, y: 4, w: 7, h: 28, rot: 0 },
  ring: { x: 29.6, y: 7, w: 7, h: 25, rot: 0 },
  little: { x: 37.2, y: 14, w: 6.2, h: 18, rot: 0 },
};
const NAMES = Object.keys(GEOM);
const FOUR = NAMES.filter((n) => n !== 'thumb');
/** Дополнительный поворот отведённого пальца, градусы (от группы остальных). */
export const SPLAY = Object.freeze({ thumb: -22, index: -16, middle: -8, ring: 10, little: 20 });
export const FINGER_NAMES = Object.freeze({ thumb: 'большой', index: 'указательный', middle: 'средний', ring: 'безымянный', little: 'мизинец' });

let uid = 0;

/**
 * Что нарисовано, в виде данных (рисует handSvg; тесты читают это).
 * @param {object|null} hand подсказка удара (strokes.json → hand) или {shape:'side'}
 */
export function handModel(hand) {
  let shape = ['fingers', 'count', 'slap', 'heel', 'side', 'together'].includes(hand?.shape) ? hand.shape : 'unknown';
  const countOf = n => Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  const given = shape === 'fingers' && Array.isArray(hand.fingers) ? NAMES.filter((n) => hand.fingers.includes(n)) : [];
  if (shape === 'fingers' && !given.length) shape = 'unknown';
  const active = shape === 'fingers' ? given : shape === 'slap' ? FOUR : [];
  const single = shape === 'fingers' && active.length === 1;
  const lead = single ? active[0] : null;
  const fingers = NAMES.map((name) => {
    const on = active.includes(name);
    return {
      name,
      on,
      tip: on,
      splay: single && on ? SPLAY[name] : 0,
      // Неназванные пальцы сжаты и укорочены, чтобы названный был виден отдельно.
      curled: single && !on && name !== 'thumb' && lead !== 'thumb',
    };
  });
  return {
    shape,
    fingers,
    single,
    palm: shape === 'slap',
    heel: shape === 'heel',
    count: shape === 'count' ? countOf(hand.count) : null,
    then: shape === 'count' ? countOf(hand.then) : null,
    sequence: shape === 'slap',
    generic: shape === 'count' || shape === 'unknown' || shape === 'side' || shape === 'together',
  };
}

function fingerSvg(f, g, single, fill, dash) {
  const bottom = g.y + g.h + 3;
  const curl = f.curled ? g.h * 0.5 : 0;
  const ext = f.on && single ? 3 : 0;
  const top = g.y + curl - ext;
  const rot = g.rot + f.splay;
  const cx = g.x + g.w / 2;
  const marks = f.splay ? ` data-splay="${f.splay}"` : '';
  const curled = f.curled ? ' data-curled="1"' : '';
  const rect = `<rect class="finger${f.on ? ' on' : ''}" data-finger="${f.name}"${marks}${curled} x="${g.x}" y="${top}" width="${g.w}" height="${bottom - top}" rx="${g.w / 2}" fill="${f.on ? fill : 'none'}"${dash}/>`;
  const tip = f.tip ? `<circle class="tip" data-tip="${f.name}" cx="${cx}" cy="${top + g.w * 0.62}" r="${g.w * 0.62}"/>` : '';
  return rot ? `<g transform="rotate(${rot} ${cx} ${g.y + g.h})">${rect}${tip}</g>` : `${rect}${tip}`;
}

/** Значок тембра в углу схемы (с внешней от большого пальца стороны): отдельно от места касания. */
function badgeSvg(timbre, x) {
  if (timbre === 'muted') {
    return `<g class="timbre-badge" data-timbre="muted"><circle class="tb-disc" cx="${x}" cy="51.5" r="5.5"/><path class="tb-mark" d="M${x - 2} 48.5 V54.5 M${x + 2} 48.5 V54.5"/></g>`;
  }
  if (timbre === 'ringing') {
    return `<g class="timbre-badge" data-timbre="ringing"><circle class="tb-disc" cx="${x}" cy="51.5" r="5.5"/><path class="tb-mark" d="M${x - 2.2} 51.5 q2.2 -3.6 4.4 0 M${x - 2.2} 51.5 q2.2 3.6 4.4 0"/></g>`;
  }
  return '';
}

/**
 * @param {object} hand подсказка удара (strokes.json → hand); {shape:'side'} — только сторона
 * @param {{lane?: string, tentative?: boolean, size?: number, timbre?: 'ringing'|'muted'|null}} [opts]
 *   lane: 'left' — схема зеркалится; tentative — нарисовать как предположение
 */
export function handSvg(hand, { lane = 'right', tentative = false, size = 40, timbre = null } = {}) {
  const id = `h${++uid}`;
  const m = handModel(hand);
  const mirrored = lane === 'left';
  const mx = (x) => (mirrored ? W - x : x);
  const dash = tentative || m.shape === 'count' || m.shape === 'unknown' ? ' stroke-dasharray="2.4 1.8"' : '';
  const hatch = `url(#${id}h)`;
  const fingers = m.fingers.map((f) => fingerSvg(f, GEOM[f.name], m.single, hatch, dash)).join('');
  // Ладонь рисуется поверх оснований пальцев (неосвещённая — цветом фона, см. styles.css).
  const palm = `<path class="palm${m.palm ? ' on' : ''}" d="M13 31 H44 V45 Q44 55 33 55 H23 Q13 55 13 46 Z" fill="${m.palm ? hatch : 'none'}"${dash}/>`;
  let extra = '';
  if (m.heel) {
    extra = `<ellipse class="heel on" cx="28.5" cy="49.5" rx="12" ry="4.6" fill="url(#${id}h)"/>`
      + '<path class="bounce" d="M14 4 q3.5 -3.5 7 0 M30 2 q3.5 -3.5 7 0" fill="none"/>';
  } else if (m.shape === 'slap') {
    extra = '<path class="arrow" d="M47.5 4 V28 m-2.6 -3.2 l2.6 3.2 l2.6 -3.2" fill="none"/>';
  }
  const mirror = mirrored ? ` transform="translate(${W} 0) scale(-1 1)"` : '';
  // Текст внутри зеркальной группы читался бы задом наперёд — выносим его наружу
  // и сами отражаем его позицию.
  const palmX = mx(28.5);
  let text = '';
  if (m.shape === 'count') text = `<text class="count" x="${palmX}" y="48" text-anchor="middle">${m.count ?? '?'}${m.then ? `→${m.then}` : ''}</text>`;
  else if (m.shape === 'unknown') text = `<text class="count" x="${palmX}" y="48" text-anchor="middle">?</text>`;
  else if (m.sequence) {
    // 1 — кончики пальцев (на кончике среднего), 2 — ладонь.
    text = `<g class="seq-marks"><text class="seq-n" x="${mx(25.3)}" y="10.2" text-anchor="middle">1</text>`
      + `<circle class="seq-dot" cx="${palmX}" cy="42" r="4.4"/><text class="seq-n seq-n2" x="${palmX}" y="44.2" text-anchor="middle">2</text></g>`;
  }
  const title = handTitle(hand, lane);
  return `<svg class="hand${tentative ? ' tentative' : ''}" data-shape="${m.shape}"${timbre === 'muted' ? ' data-tone="muted"' : ''} viewBox="0 0 ${W} 58" width="${size}" height="${Math.round(size * 58 / W)}" role="img" aria-label="${title}">
    <defs><pattern id="${id}h" class="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-bg" width="3" height="3"/><line class="hatch-line" x1="0" y1="0" x2="0" y2="3"/></pattern></defs>
    <g${mirror}>${fingers}${palm}${extra}</g>${text}${badgeSvg(timbre, mx(8))}</svg>`;
}

/** Кисть только с указанием стороны: контур без отмеченных пальцев. */
export function sideHandSvg({ lane = 'right', size = 40, timbre = null } = {}) {
  return handSvg({ shape: 'side' }, { lane, size, timbre });
}

/** Подпись для экранного диктора и всплывающей подсказки. */
export function handTitle(hand, lane) {
  const side = lane === 'left' ? 'левая рука' : lane === 'right' ? 'правая рука' : 'рука не определена';
  const shape = hand?.shape ?? 'unknown';
  if (shape === 'fingers' && Array.isArray(hand.fingers)) return `${side}: ${hand.fingers.map((f) => FINGER_NAMES[f] ?? '').filter(Boolean).join(', ')}`;
  if (shape === 'count') return `${side}: ${handModel(hand).count ?? '?'} пальц.`;
  if (shape === 'slap') return `${side}: шлепок пальцами и ладонью`;
  if (shape === 'heel') return `${side}: основание ладони, пальцы отскакивают`;
  return `${side}`;
}

/** Названные пальцы словами («указательный») или пустая строка. */
export function fingerWords(hand) {
  return hand?.shape === 'fingers' && Array.isArray(hand.fingers) ? hand.fingers.map((f) => FINGER_NAMES[f] ?? '').filter(Boolean).join(', ') : '';
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

/**
 * Большая неподвижная мриданга для сцены тренировки: слева большая мембрана
 * (левая рука), справа малая (правая рука). Рисуется один раз; какая мембрана
 * подсвечена, задаёт атрибут data-hit корня: left, right, both или any.
 */
export function mridangaSvg({ label = 'мриданга' } = {}) {
  return `<svg class="mridanga" viewBox="0 0 240 126" role="img" aria-label="${label}">
    <path class="md-body" d="M34 16 C53 5 73 3 94 9 C130 18 156 37 181 42 Q193 45 208 44 L208 82 Q192 81 181 84 C155 90 129 109 94 117 C73 123 53 120 34 110 Z"/>
    <path class="md-lace" d="M42 17 Q65 62 88 117 M42 110 Q65 64 88 8 M83 8 Q108 62 132 103 M83 118 Q108 68 132 24 M128 23 Q151 65 170 87 M128 105 Q150 63 170 40 M168 40 L195 82 M168 87 L195 44"/>
    <ellipse class="md-glow md-glow-left" cx="34" cy="63" rx="25" ry="52"/>
    <ellipse class="md-glow md-glow-right" cx="208" cy="63" rx="13" ry="23"/>
    <ellipse class="md-head md-head-left" cx="34" cy="63" rx="20" ry="47"/>
    <ellipse class="md-spot" cx="34" cy="63" rx="10" ry="26"/>
    <ellipse class="md-head md-head-right" cx="208" cy="63" rx="9" ry="19"/>
    <ellipse class="md-spot" cx="208" cy="63" rx="4" ry="11"/>
  </svg>`;
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
