// Звук в браузере: метроном и СИНТЕЗИРОВАННЫЙ эталон ударов через Web Audio.
// Это не запись мриданги: тембр — грубое приближение по звуковым профилям
// (audio/sound-profile.js, отсчёты считает чистая audio/dsp.js). Настоящий эталон —
// фрагмент видео преподавателя (см. страницу урока).
import { createPlan, eventsInPlan, planEnd, retimePlan } from './transport.js';
import { normalizeProfile } from './sound-profile.js?v=0.3.1';
import { renderStroke, sanitizeRate, ACCENT_GAIN } from './dsp.js?v=0.3.1';

export { createPlan };

const LOOKAHEAD_SEC = 0.12;  // насколько вперёд планируем звук
const TICK_MS = 25;          // как часто проверяем окно
export const BUFFER_CACHE_MAX = 48; // готовых звуков на один AudioContext (профиль × акцент)

// Готовые AudioBuffer удара: один раз на профиль и акцент, дальше — только запуск источника.
// Кэш ограничен, при переполнении уходит давно не игравший звук.
const bufferCaches = new WeakMap();

export function strokeBufferCount(ctx) { return bufferCaches.get(ctx)?.size ?? 0; }

function strokeBuffer(ctx, profile, accent) {
  let cache = bufferCaches.get(ctx);
  if (!cache) { cache = new Map(); bufferCaches.set(ctx, cache); }
  const key = `${accent ? 'a' : 'n'}|${profile.key}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const sr = sanitizeRate(ctx.sampleRate);
  const pcm = renderStroke(profile, { sampleRate: sr, accent });
  const buf = ctx.createBuffer(1, pcm.length, sr);
  if (typeof buf.copyToChannel === 'function') buf.copyToChannel(pcm, 0);
  else buf.getChannelData(0).set(pcm);
  cache.set(key, buf);
  if (cache.size > BUFFER_CACHE_MAX) cache.delete(cache.keys().next().value);
  return buf;
}

/** Запасной голос (прежний): синус с падающей высотой. Нужен, только если PCM собрать не удалось. */
function playToneFallback(ctx, out, at, p, accent, level) {
  const g = ctx.createGain();
  const peak = Math.min(1, p.gain * (accent ? ACCENT_GAIN : 1)) * level;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + p.decay);
  g.connect(out);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(p.pitch, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.pitch * p.bend), at + p.decay);
  osc.connect(g);
  osc.start(at);
  osc.stop(at + p.decay + 0.02);
}

/**
 * Один удар учебного синтеза. `sound` — профиль из sound-profile.js (его строит
 * приложение для практики и для «Послушать») или «сырой» sound из данных.
 * level < 1 — доля громкости, когда в одну долю звучит несколько отдельных ударов.
 */
export function playStroke(ctx, out, at, sound, accent = false, level = 1) {
  const profile = normalizeProfile(sound);
  let buf = null;
  try { buf = strokeBuffer(ctx, profile, accent); } catch { buf = null; }
  if (!buf) { playToneFallback(ctx, out, at, profile, accent, level); return; }
  const g = ctx.createGain();
  g.gain.value = level;
  g.connect(out);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(g);
  src.start(at);
}

function playClick(ctx, out, at, strong) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = strong ? 1600 : 1100;
  g.gain.setValueAtTime(strong ? 0.25 : 0.15, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.04);
}

/**
 * Проигрыватель упражнения. Время берётся из плана воспроизведения
 * (audio/transport.js) и часов Web Audio: onStep(ev) вызывается в момент,
 * на который запланирован звук поддоли, а лента читает те же часы через now().
 */
export class Player {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.visualTimers = [];
    this.plan = null;
    this.t0 = 0;
    this.scheduledTo = 0;
    this.volume = 0.8;
    // Поколение запуска: каждый start() и stop() его меняют. Запуск, дождавшийся
    // ctx.resume() уже после «Стоп», навигации или другого запуска, видит чужое
    // поколение и ничего не создаёт — ни выхода, ни таймеров.
    this.gen = 0;
    this.pending = false;
    this.lastError = null;
    this.pausedAt = null;
    this.pendingSteps = new Map();
  }

  /** Звук запланирован или идёт. Ожидание resume() сюда не входит — см. starting. */
  get playing() { return this.timer !== null; }

  /** Запуск ждёт разрешения браузера на звук (ctx.resume()). */
  get starting() { return this.pending; }

  get paused() { return this.pausedAt !== null; }

  /** Время плана по часам звука (секунды от начала прогона); null — не играет. */
  now() {
    return this.paused ? this.pausedAt : this.plan && this.ctx ? this.ctx.currentTime - this.t0 : null;
  }

  /** Громкость 0…1; применяется сразу, в том числе к уже идущему прогону. */
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (this.out) this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  /** Сведения о звуке для диагностики. Задержки — то, что СООБЩАЕТ браузер, а не измерение. */
  audioInfo() {
    const c = this.ctx;
    if (!c) return { state: 'не создан' };
    return {
      state: c.state,
      sampleRate: c.sampleRate,
      baseLatency: Number.isFinite(c.baseLatency) ? c.baseLatency : null,
      outputLatency: Number.isFinite(c.outputLatency) ? c.outputLatency : null,
    };
  }

  /**
   * @param {object} p
   * @param {object} p.plan план из createPlan
   * @param {Map<string, object>} p.strokeSounds id удара → параметры звука
   * @param {string} p.metronomeId
   * @param {boolean} p.playStrokes звучит ли синтезированный эталон
   * @param {(ev: object) => void} [p.onStep]
   * @param {() => void} [p.onEnd]
   * @returns {Promise<'started' | 'cancelled' | 'failed'>} cancelled — запуск
   *   отменён «Стоп», навигацией или новым запуском, пока браузер включал звук;
   *   failed — браузер отказал (причина в lastError), ничего не создано
   */
  async start(p) {
    this.stop();
    return this.activate(p, this.gen);
  }

  /** Continue the same plan, counters and tempo segments after a user pause. */
  async resume() {
    if (!this.paused || this.pending) return 'cancelled';
    return this.activate(this.params, ++this.gen, true);
  }

  async activate(p, gen, resuming = false) {
    this.pending = true;
    this.lastError = null;
    try {
      // Request the media category during the Play gesture, before Web Audio starts.
      // On iOS the default category can mute synthesis while the audio clock runs.
      try {
        const session = window.navigator?.audioSession;
        if (session && session.type !== 'playback') session.type = 'playback';
      } catch { /* Optional capability. Browsers without it still use Web Audio. */ }
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
        this.pending = true;
        await this.ctx.resume();
      }
      if (this.ctx.state !== 'running') throw new Error('Звук приостановлен браузером');
    } catch (e) {
      if (gen !== this.gen) return 'cancelled';
      this.pending = false;
      this.lastError = e;
      return 'failed';
    }
    if (gen !== this.gen) return 'cancelled';
    this.pending = false;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(ctx.destination);
    this.out = out;
    if (!resuming) this.plan = p.plan;
    this.params = p;
    this.t0 = resuming ? ctx.currentTime - this.pausedAt : ctx.currentTime + 0.1;
    // Events at/before the pause have already sounded. Cancelled look-ahead
    // events after it must be scheduled again, with the remaining gap intact.
    this.scheduledTo = resuming ? Math.max(0, this.pausedAt + 1e-7) : 0;
    this.pausedAt = null;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    return 'started';
  }

  tick() {
    const { ctx, out, params: p } = this;
    if (!this.plan || !out) return;
    const total = planEnd(this.plan);
    const until = Math.min(ctx.currentTime - this.t0 + LOOKAHEAD_SEC, total);
    if (until <= this.scheduledTo) return;
    const batch = eventsInPlan(this.plan, this.scheduledTo, until, { metronomeId: p.metronomeId });
    for (const ev of batch) {
      const at = this.t0 + ev.at;
      if (ev.click) playClick(ctx, out, at, ev.clickStrong);
      if (p.playStrokes && !ev.rest) {
        // Несколько отдельных ударов в одной поддоле делят громкость, чтобы сумма не клиппировала.
        const level = ev.strokes.length > 1 ? 1 / Math.sqrt(ev.strokes.length) : 1;
        for (const id of ev.strokes) playStroke(ctx, out, at, p.strokeSounds.get(id), ev.accent, level);
      }
      const delayMs = Math.max(0, (at - ctx.currentTime) * 1000);
      const gen = this.gen;
      const timer = setTimeout(() => {
        this.pendingSteps.delete(ev.seq);
        if (gen === this.gen && !this.paused) p.onStep?.(ev);
      }, delayMs);
      this.pendingSteps.set(ev.seq, { ev, timer });
    }
    this.scheduledTo = until;
    if (this.scheduledTo >= total) {
      const endMs = Math.max(0, (this.t0 + total - ctx.currentTime) * 1000);
      const gen = this.gen;
      this.visualTimers.push(setTimeout(() => {
        if (gen !== this.gen || this.paused) return;
        this.stop(); p.onEnd?.();
      }, endMs));
      clearInterval(this.timer);
      this.timer = 0; // «идёт», пока не сработает финальный таймер
    }
  }

  /**
   * Сменить темп с ближайшей ещё не запланированной границы цикла.
   * @returns {{cycle: number, at: number} | null} null — не играет или граница за концом прогона
   */
  retime(timeline, rate) {
    if ((!this.playing && !this.paused) || !this.plan) return null;
    const r = retimePlan(this.plan, this.paused ? Math.max(0, this.pausedAt + 1e-7) : this.scheduledTo, timeline, rate);
    if (!r) return null;
    this.plan = r.plan;
    return { cycle: r.cycle, at: r.at };
  }

  /** Freeze between attacks without suspending the iPhone audio session. */
  pause() {
    if (!this.playing || this.pending) return false;
    const at = this.now();
    // A busy UI can delay visual callbacks even though their audio has sounded.
    // Account for those once before cancelling the remaining look-ahead window.
    for (const { ev, timer } of this.pendingSteps.values()) {
      if (ev.at <= at) {
        clearTimeout(timer);
        this.pendingSteps.delete(ev.seq);
        this.params.onStep?.(ev);
      }
    }
    if (at >= planEnd(this.plan)) {
      const onEnd = this.params.onEnd;
      this.stop(); onEnd?.();
      return false;
    }
    this.pausedAt = at;
    this.gen += 1;
    this.clearPlayback();
    return true;
  }

  clearPlayback() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.visualTimers.forEach(clearTimeout);
    this.visualTimers = [];
    this.pendingSteps.forEach(({ timer }) => clearTimeout(timer));
    this.pendingSteps.clear();
    if (this.out) {
      // Обрываем уже запланированные звуки, иначе после «Стоп» доигрывается окно.
      try { this.out.disconnect(); } catch { /* уже отключён */ }
      this.out = null;
    }
  }

  /** Stop also discards the saved pause position and cancels pending resume. */
  stop() {
    this.gen += 1;
    this.pending = false;
    this.clearPlayback();
    this.plan = null;
    this.params = null;
    this.pausedAt = null;
  }
}
