// Цепочка кадров плавного хода ленты. Одна на упражнение: sync() — единственное
// место, где она запускается или гасится (смена вида, старт, конец прогона),
// поэтому второй параллельной цепочки не бывает. Звук и прогресс отсюда не
// трогаются — кадр только сдвигает ленту.

/**
 * @param {object} p
 * @param {() => boolean} p.wanted нужен ли сейчас ход (идёт звук, вид «Лента», движение не уменьшено)
 * @param {() => void} p.frame один кадр: поставить ленту по часам звука
 * @param {(cb: () => void) => number} [p.request] requestAnimationFrame
 * @param {(id: number) => void} [p.cancel] cancelAnimationFrame
 */
export function createMotion({ wanted, frame, request = (cb) => requestAnimationFrame(cb), cancel = (id) => cancelAnimationFrame(id) }) {
  let id = 0;
  const tick = () => {
    id = 0;
    if (!wanted()) return;
    frame();
    id = request(tick);
  };
  return {
    /** Привести цепочку в соответствие с wanted(): запустить, если нужна и не идёт; погасить, если не нужна. */
    sync() {
      if (wanted()) {
        if (!id) id = request(tick);
      } else if (id) {
        cancel(id);
        id = 0;
      }
    },
    get active() { return id !== 0; },
  };
}
