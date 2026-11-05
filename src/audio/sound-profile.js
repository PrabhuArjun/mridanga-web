// Звуковые профили учебного синтеза: из описания удара (content/strokes.json)
// получается семейство звука и числа для него. Чистые функции без Web Audio и DOM:
// их проверяет tests/sound-profile.test.js. Исходный JSON не меняется.
//
// Это ГРУБОЕ учебное разделение по тому, что уже сказано в данных (рука, форма
// кисти, слова описания, параметры sound), а не традиционная классификация ударов
// мриданги и не запись инструмента. Похожие по описанию удары остаются в одном семействе.
import { MUTED_WORDS } from '../model/display.js?v=0.3.0';

/** Семейства звука. «combined» — несколько слоёв одновременно (удар двумя руками). */
export const FAMILIES = Object.freeze(['dry', 'ring', 'bass', 'slap', 'muted', 'glide', 'combined']);

/** Короткие подписи для страницы «Звук». */
export const FAMILY_INFO = Object.freeze({
  dry: { label: 'Сухой', note: 'короткий, кончики пальцев' },
  ring: { label: 'Звонкий', note: 'высокий, с послезвучием' },
  bass: { label: 'Басовый', note: 'низкий, гулкий' },
  slap: { label: 'Шлепок', note: 'ладонью, с шумом' },
  muted: { label: 'Глухой', note: 'придержанный, быстро гаснет' },
  glide: { label: 'Скольжение', note: 'высота плывёт' },
  combined: { label: 'Составной', note: 'два звука вместе' },
});

/**
 * Удары, которые курс прямо называет одним и тем же приёмом
 * (V08 00:47: «Ki, Ke, Ko — один и тот же шлепок»). Их профиль берётся у первого
 * из группы, поэтому звучат они одинаково, даже если числа в данных разойдутся.
 * Прочие одинаково подписанные удары («Да», «На», «Ти», «Ди») звучат по своим данным.
 */
export const SAME_GESTURE = Object.freeze([Object.freeze(['ke', 'ko', 'ki'])]);

export const MAX_LAYERS = 4;

const DEFAULTS = Object.freeze({ pitch: 300, bend: 0.85, decay: 0.25, noise: 0.2, gain: 0.6 });
const LIMITS = Object.freeze({
  pitch: [40, 4000], bend: [0.3, 2.5], decay: [0.02, 1], noise: [0, 1], gain: [0.05, 1],
});

const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));
const r3 = (x) => Math.round(x * 1000) / 1000;

function toNumber(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Параметры звука: только конечные числа в безопасных пределах, остальное — значения по умолчанию. */
export function sanitizeSound(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = clamp(toNumber(src[k], DEFAULTS[k]), LIMITS[k]);
  return out;
}

/** Семейство только по числам (для ударов без описания и для испорченных данных). */
export function classifySound(s) {
  if (s.pitch < 250) return s.noise >= 0.4 && s.decay < 0.15 ? 'slap' : 'bass';
  return s.decay >= 0.15 ? 'ring' : 'dry';
}

/** Семейство одного (не составного) удара по его описанию. */
function singleFamily(stroke, s) {
  if (stroke.glyph === 'slide' || s.bend > 1) return 'glide';
  if (stroke.hand?.shape === 'slap' || stroke.glyph === 'hatched') return 'slap';
  const text = String(stroke.technique ?? '').toLowerCase();
  if (MUTED_WORDS.some((w) => text.includes(w))) return 'muted';
  if (stroke.hand?.shape === 'heel') return 'bass';
  return classifySound(s);
}

export function profileKey(p) {
  const base = `${p.family}:${r3(p.pitch)}/${r3(p.bend)}/${r3(p.decay)}/${r3(p.noise)}/${r3(p.gain)}`;
  return p.layers?.length ? `${base}[${p.layers.map((l) => l.key).join('+')}]` : base;
}

const made = new WeakSet();

function make(family, sound, layers = []) {
  const p = { family, ...sound, layers: Object.freeze(layers) };
  p.key = profileKey(p);
  const frozen = Object.freeze(p);
  made.add(frozen);
  return frozen;
}

/**
 * Профиль звука удара.
 * @param {object} stroke удар из strokes.json
 * @param {Map<string, object>} byId удары по id (для составных)
 * @returns {{family: string, pitch: number, bend: number, decay: number, noise: number, gain: number, layers: object[], key: string}}
 */
export function soundProfile(stroke, byId = new Map(), depth = 0) {
  if (!stroke || typeof stroke !== 'object') return normalizeProfile(null);
  const own = sanitizeSound(stroke.sound);
  if (Array.isArray(stroke.combination) && stroke.combination.length > 1 && depth < 2) {
    // Составной удар звучит слоями составляющих; его собственный gain задаёт общую громкость.
    const layers = stroke.combination
      .map((id) => byId.get(id))
      .filter(Boolean)
      .flatMap((c) => {
        const p = soundProfile(c, byId, depth + 1);
        return p.family === 'combined' ? p.layers : [p];
      })
      .slice(0, MAX_LAYERS);
    if (layers.length >= 2) return make('combined', own, layers);
    return make(classifySound(own), own);
  }
  return make(singleFamily(stroke, own), own);
}

/** Профили всех ударов: id → профиль. Один источник для практики и для «Послушать». */
export function buildSoundProfiles(strokes) {
  const list = Array.isArray(strokes) ? strokes.filter((s) => s && typeof s === 'object' && typeof s.id === 'string') : [];
  const byId = new Map(list.map((s) => [s.id, s]));
  const lead = new Map();
  const out = new Map();
  for (const s of list) {
    const group = SAME_GESTURE.find((g) => g.includes(s.id));
    const leadId = group ? group.find((id) => byId.has(id)) : null;
    if (leadId && leadId !== s.id) {
      if (!lead.has(leadId)) lead.set(leadId, soundProfile(byId.get(leadId), byId));
      out.set(s.id, lead.get(leadId));
    } else {
      out.set(s.id, soundProfile(s, byId));
    }
  }
  return out;
}

/**
 * Привести что угодно к профилю: готовый профиль, «сырой» объект sound из данных
 * или испорченное значение. Не бросает исключений; числа конечные и в пределах.
 */
export function normalizeProfile(raw) {
  if (raw && typeof raw === 'object' && made.has(raw)) return raw;
  const s = sanitizeSound(raw);
  const family = raw && typeof raw === 'object' && FAMILIES.includes(raw.family) ? raw.family : classifySound(s);
  if (family === 'combined') {
    const layers = Array.isArray(raw.layers)
      // Слой сам не составной: вложенные «layers» отбрасываются.
      ? raw.layers.filter((l) => l && typeof l === 'object').slice(0, MAX_LAYERS)
        .map((l) => normalizeProfile({ ...l, layers: undefined }))
      : [];
    if (layers.length >= 2) return make('combined', s, layers);
    return make(classifySound(s), s);
  }
  return make(family, s);
}

/** Подпись семейства для экрана. */
export function familyLabel(profile) {
  return (FAMILY_INFO[profile?.family] ?? FAMILY_INFO.dry).label;
}
