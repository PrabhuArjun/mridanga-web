// Чистый синтез одного удара в PCM (Float32Array) по звуковому профилю.
// Без Web Audio и случайности: один и тот же профиль всегда даёт те же отсчёты,
// поэтому форму сигнала можно проверить тестом без браузера (tests/sound-profile.test.js).
// Это учебный синтез, а не запись инструмента: семейства отличаются атакой, затуханием,
// шумовой составляющей и слоями, а не только громкостью или одной высотой.
import { normalizeProfile } from './sound-profile.js?v=0.3.1';

export const PEAK_CEILING = 0.9;   // пик любого удара, с акцентом тоже
export const MAX_SECONDS = 1.1;    // длина любого удара
export const ACCENT_GAIN = 1.5;
const TAU = Math.PI * 2;

/** Частота дискретизации в безопасных пределах; не число — 48000. */
export function sanitizeRate(sr) {
  return typeof sr === 'number' && Number.isFinite(sr) ? Math.min(96000, Math.max(8000, Math.round(sr))) : 48000;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Детерминированный генератор 0…1 (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lpCoef = (f, sr) => 1 - Math.exp(-TAU * Math.min(f, sr * 0.45) / sr);

/**
 * Рецепты семейств.
 *  partials: [отношение частоты, амплитуда, доля затухания] — доля умножает decay профиля;
 *  attack: нарастание тона, с; hold/bend: выдержка и время изменения высоты (доля decay);
 *  drive: мягкое насыщение тона (богаче обертоны); level: громкость тона относительно шума;
 *  noise: всплески шума [начало с, длина с, уровень, срез ФВЧ Гц, срез ФНЧ Гц];
 *  dull: общий ФНЧ (глухой звук); decayScale: общий множитель затухания.
 */
const RECIPES = {
  // Короткий сухой щелчок кончиками пальцев: быстрый спад, яркий шум.
  dry: {
    attack: 0.0006, level: 1, decayScale: 1, drive: 1, hold: 0, bend: 1,
    partials: [[1, 1, 1], [2.4, 0.35, 0.55], [3.9, 0.15, 0.35]],
    noise: [[0, 0.011, 1.4, 2500, 9000]],
  },
  // Звонкий: гармонические обертоны, заметное послезвучие, лёгкий щелчок в начале.
  ring: {
    attack: 0.001, level: 1, decayScale: 1, drive: 1, hold: 0, bend: 1,
    partials: [[1, 1, 1], [2, 0.5, 0.7], [3.02, 0.3, 0.5], [4.95, 0.15, 0.3]],
    noise: [[0, 0.006, 2, 3500, 10000]],
  },
  // Басовый: низкий тон с падением высоты, насыщение, глухой толчок вместо яркого шума.
  bass: {
    attack: 0.002, level: 1, decayScale: 1, drive: 1.6, hold: 0, bend: 1,
    partials: [[1, 1, 1], [1.98, 0.55, 0.6], [3.1, 0.25, 0.4]],
    noise: [[0, 0.02, 6, 0, 600]],
  },
  // Шлепок: сначала кончики пальцев (яркий щелчок), через 7 мс ладонь (широкий шум + толчок).
  slap: {
    attack: 0.0008, level: 0.7, decayScale: 0.7, drive: 1.2, hold: 0, bend: 1,
    partials: [[1, 1, 1], [2.1, 0.4, 0.5]],
    noise: [[0, 0.008, 1.8, 1800, 8000], [0.007, 0.03, 2.6, 500, 3000]],
  },
  // Глухой: короткий, затухает сразу, без звона; тёмный из-за общего ФНЧ.
  muted: {
    attack: 0.002, level: 1, decayScale: 0.6, drive: 1, hold: 0, bend: 1,
    partials: [[1, 1, 1], [1.7, 0.4, 0.6]],
    noise: [[0, 0.012, 3, 0, 900]], dull: 1200,
  },
  // Скольжение: резонанс, затем высота плавно меняется; мягкая атака.
  glide: {
    attack: 0.004, level: 1, decayScale: 0.7, drive: 1, hold: 0.03, bend: 0.8,
    partials: [[1, 1, 1], [2, 0.4, 0.6]],
    noise: [[0, 0.01, 3, 0, 1500]],
  },
};

function renderLayer(p, sr, target) {
  const rec = RECIPES[p.family] ?? RECIPES.dry;
  const decay = p.decay * rec.decayScale;
  let span = 0;
  for (const [, , mul] of rec.partials) span = Math.max(span, decay * mul);
  for (const [at, len] of rec.noise) span = Math.max(span, at + len);
  const n = Math.max(32, Math.ceil(Math.min(MAX_SECONDS, span + 0.012) * sr));
  const out = new Float32Array(n);

  // Тон: фаза накапливается по текущей высоте, поэтому изменение высоты без щелчков.
  const bendTime = Math.max(1e-3, decay * rec.bend);
  const nyquist = sr * 0.45;
  const parts = rec.partials
    .filter(([ratio]) => p.pitch * ratio * Math.max(1, p.bend) <= nyquist)
    .map(([ratio, amp, mul]) => ({ ratio, amp, k: Math.exp(-6.9 / (Math.max(1e-3, decay * mul) * sr)), env: 1, phase: 0 }));
  const driveNorm = rec.drive > 1 ? Math.tanh(rec.drive) : 1;
  const attackN = Math.max(1, rec.attack * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const curve = Math.pow(p.bend, Math.min(1, Math.max(0, (t - rec.hold) / bendTime)));
    const a = Math.min(1, (i + 1) / attackN);
    let tone = 0;
    for (const q of parts) {
      q.phase += TAU * p.pitch * q.ratio * curve / sr;
      tone += q.amp * q.env * Math.sin(q.phase);
      q.env *= q.k;
    }
    tone *= a * rec.level;
    out[i] = rec.drive > 1 ? Math.tanh(rec.drive * tone) / driveNorm : tone;
  }

  // Шум: всплески с собственной огибающей и полосой (ФВЧ = сигнал минус ФНЧ).
  rec.noise.forEach(([at, len, level, hp, lp], idx) => {
    const rand = rng(hash(`${p.key}#${idx}`));
    const i0 = Math.round(at * sr);
    const count = Math.min(n - i0, Math.ceil(len * sr * 2));
    const kLp = lp > 0 ? lpCoef(lp, sr) : 1;
    const kHp = hp > 0 ? lpCoef(hp, sr) : 0;
    const k = Math.exp(-6.9 / (len * sr));
    let env = p.noise * level;
    let yLp = 0;
    let yHp = 0;
    for (let j = 0; j < count; j++) {
      const w = rand() * 2 - 1;
      yLp += kLp * (w - yLp);
      yHp += kHp * (yLp - yHp);
      out[i0 + j] += (hp > 0 ? yLp - yHp : yLp) * env;
      env *= k;
    }
  });

  if (rec.dull) {
    const k = lpCoef(rec.dull, sr);
    let y = 0;
    for (let i = 0; i < n; i++) { y += k * (out[i] - y); out[i] = y; }
  }
  return normalize(out, target, sr);
}

/** Привести пик к target и плавно убрать хвост, чтобы не было щелчка в конце. */
function normalize(buf, target, sr) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    if (!Number.isFinite(buf[i])) buf[i] = 0;
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  const scale = peak > 1e-9 ? target / peak : 0;
  const fade = Math.min(Math.floor(0.004 * sr), buf.length >> 1);
  for (let i = 0; i < buf.length; i++) {
    const tail = i >= buf.length - fade ? (buf.length - 1 - i) / fade : 1;
    buf[i] = Math.max(-1, Math.min(1, buf[i] * scale * tail));
  }
  return buf;
}

/**
 * Отсчёты одного удара (моно).
 * @param {object} profile профиль из sound-profile.js, «сырой» sound из данных или мусор
 * @param {{sampleRate?: number, accent?: boolean}} [opts]
 * @returns {Float32Array} конечные значения, |x| ≤ PEAK_CEILING, длина ≤ MAX_SECONDS
 */
export function renderStroke(profile, { sampleRate, accent = false } = {}) {
  const p = normalizeProfile(profile);
  const sr = sanitizeRate(sampleRate);
  const target = Math.min(PEAK_CEILING, p.gain * (accent ? ACCENT_GAIN : 1));
  if (p.family !== 'combined') return renderLayer(p, sr, target);
  // Составной удар: каждый слой — со своей громкостью, сумма приводится к одному пику,
  // поэтому «Дхин» не громче одиночного удара с тем же gain.
  const layers = p.layers.map((l) => renderLayer(l, sr, l.gain));
  const mix = new Float32Array(Math.max(...layers.map((l) => l.length)));
  for (const l of layers) for (let i = 0; i < l.length; i++) mix[i] += l[i];
  return normalize(mix, target, sr);
}

/**
 * Простые признаки формы сигнала для проверки без прослушивания.
 * t30Ms — время, после которого уровень (блоки по 2 мс) ниже −30 дБ от максимума;
 * rmsFreqHz — среднеквадратичная частота первых 40 мс (грубая «яркость»).
 */
export function analyzeStroke(pcm, sampleRate = 48000) {
  const sr = sanitizeRate(sampleRate);
  const n = pcm?.length ?? 0;
  if (!n) return { peak: 0, rms: 0, peakMs: 0, t30Ms: 0, rmsFreqHz: 0, durationMs: 0 };
  let peak = 0;
  let peakAt = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) { peak = a; peakAt = i; }
    sumSq += a * a;
  }
  const block = Math.max(1, Math.round(sr * 0.002));
  const levels = [];
  let top = 0;
  for (let i = 0; i < n; i += block) {
    let s = 0;
    const end = Math.min(n, i + block);
    for (let j = i; j < end; j++) s += pcm[j] * pcm[j];
    const v = Math.sqrt(s / (end - i));
    levels.push(v);
    top = Math.max(top, v);
  }
  const floor = top * Math.pow(10, -30 / 20);
  let last = 0;
  levels.forEach((v, k) => { if (v >= floor) last = k; });
  const w = Math.min(n, Math.round(sr * 0.04));
  let e = 0;
  let d = 0;
  for (let i = 0; i < w; i++) {
    e += pcm[i] * pcm[i];
    if (i > 0) d += (pcm[i] - pcm[i - 1]) ** 2;
  }
  return {
    peak,
    rms: Math.sqrt(sumSq / n),
    peakMs: (peakAt / sr) * 1000,
    t30Ms: ((last + 1) * block / sr) * 1000,
    rmsFreqHz: e > 0 ? (sr / TAU) * Math.sqrt(d / e) : 0,
    durationMs: (n / sr) * 1000,
  };
}
