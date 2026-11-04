// Проигрыватель озвучки (готовые MP3 из манифеста). Один на страницу; запуск
// только по нажатию ученика. Перед запуском вызывается beforePlay() — приложение
// останавливает практику, чтобы звук упражнения и голос не шли одновременно.
// Синтез речи браузера здесь намеренно не используется.

/**
 * @param {{beforePlay?: () => void, onChange?: (state: string) => void, createAudio?: (src: string) => HTMLAudioElement}} [opts]
 *   state: idle | loading | playing | paused | failed
 */
export function createNarrator({ beforePlay = () => {}, onChange = () => {}, createAudio = (src) => new Audio(src) } = {}) {
  let audio = null;
  let track = null;
  let state = 'idle';
  let gen = 0;
  const set = (s) => { state = s; onChange(s, track); };

  const drop = () => {
    gen += 1;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try { audio.pause(); } catch { /* уже остановлен */ }
      audio.removeAttribute?.('src');
      try { audio.load?.(); } catch { /* освобождаем загрузку */ }
    }
    audio = null;
  };

  const api = {
    get state() { return state; },
    get track() { return track; },
    /** Начать запись сначала (или продолжить, если это та же запись на паузе). */
    async play(t) {
      if (track && t && track.src === t.src && state === 'paused') return api.resume();
      beforePlay();
      drop();
      track = t;
      const my = gen;
      audio = createAudio(t.src);
      audio.preload = 'auto';
      audio.onended = () => { if (my === gen) { drop(); set('idle'); } };
      audio.onerror = () => { if (my === gen) { drop(); set('failed'); } };
      set('loading');
      try {
        await audio.play();
        if (my === gen) set('playing');
      } catch {
        if (my === gen) { drop(); set('failed'); }
      }
    },
    pause() {
      if (state !== 'playing' || !audio) return;
      audio.pause();
      set('paused');
    },
    async resume() {
      if (state !== 'paused' || !audio) return;
      beforePlay();
      const my = gen;
      set('loading');
      try {
        await audio.play();
        if (my === gen) set('playing');
      } catch {
        if (my === gen) { drop(); set('failed'); }
      }
    },
    /** Остановить и забыть позицию (навигация, запуск практики). */
    stop() {
      const was = state;
      drop();
      track = null;
      if (was !== 'idle') set('idle');
    },
  };
  return api;
}
