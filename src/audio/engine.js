// Звук в браузере: метроном и СИНТЕЗИРОВАННЫЙ эталон ударов через Web Audio.
// Это не запись мриданги: тембр — грубое приближение «низкая/высокая мембрана,
// открыто/глухо» по параметрам из content/strokes.json. Настоящий эталон —
// фрагмент видео преподавателя (см. страницу урока).
import { createPlan, eventsInPlan, planEnd, retimePlan } from './transport.js';

export { createPlan };

const LOOKAHEAD_SEC = 0.12;  // насколько вперёд планируем звук
const TICK_MS = 25;          // как часто проверяем окно

/** Короткий удар: синус с падающей высотой + шумовая атака. */
function playStroke(ctx, out, at, sound = {}, accent = false) {
  const { pitch = 300, bend = 0.85, decay = 0.25, noise = 0.2, gain = 0.6 } = sound;
  const g = ctx.createGain();
  const peak = Math.min(1, gain * (accent ? 1.5 : 1));
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  g.connect(out);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, pitch * bend), at + decay);
  osc.connect(g);
  osc.start(at);
  osc.stop(at + decay + 0.02);

  if (noise > 0) {
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.value = noise * peak;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    src.connect(hp).connect(ng).connect(out);
    src.start(at);
  }
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
  }

  /** Звук запланирован или идёт. Ожидание resume() сюда не входит — см. starting. */
  get playing() { return this.timer !== null; }

  /** Запуск ждёт разрешения браузера на звук (ctx.resume()). */
  get starting() { return this.pending; }

  /** Время плана по часам звука (секунды от начала прогона); null — не играет. */
  now() {
    return this.plan && this.ctx ? this.ctx.currentTime - this.t0 : null;
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
    const gen = this.gen;
    this.lastError = null;
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') {
        this.pending = true;
        await this.ctx.resume();
      }
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
    this.plan = p.plan;
    this.params = p;
    this.t0 = ctx.currentTime + 0.1;
    this.scheduledTo = 0;
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
        for (const id of ev.strokes) playStroke(ctx, out, at, p.strokeSounds.get(id), ev.accent);
      }
      const delayMs = Math.max(0, (at - ctx.currentTime) * 1000);
      this.visualTimers.push(setTimeout(() => p.onStep?.(ev), delayMs));
    }
    this.scheduledTo = until;
    if (this.scheduledTo >= total) {
      const endMs = Math.max(0, (this.t0 + total - ctx.currentTime) * 1000);
      this.visualTimers.push(setTimeout(() => { this.stop(); p.onEnd?.(); }, endMs));
      clearInterval(this.timer);
      this.timer = 0; // «идёт», пока не сработает финальный таймер
    }
  }

  /**
   * Сменить темп с ближайшей ещё не запланированной границы цикла.
   * @returns {{cycle: number, at: number} | null} null — не играет или граница за концом прогона
   */
  retime(timeline, rate) {
    if (!this.timer || !this.plan) return null;
    const r = retimePlan(this.plan, this.scheduledTo, timeline, rate);
    if (!r) return null;
    this.plan = r.plan;
    return { cycle: r.cycle, at: r.at };
  }

  /** Остановить звук и отменить запуск, ожидающий ctx.resume(). Повторный вызов безопасен. */
  stop() {
    this.gen += 1;
    this.pending = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.visualTimers.forEach(clearTimeout);
    this.visualTimers = [];
    this.plan = null;
    if (this.out) {
      // Обрываем уже запланированные звуки, иначе после «Стоп» доигрывается окно.
      try { this.out.disconnect(); } catch { /* уже отключён */ }
      this.out = null;
    }
  }
}
