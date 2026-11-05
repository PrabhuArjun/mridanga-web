// Сцена тренировки с барабаном: одна неподвижная большая мриданга по центру, правая
// рука справа от неё, левая — слева, обе вместе, когда удар двумя руками; слог и текст
// приёма; две маленькие подсказки следующих ударов.
//
// Каркас рисуется ОДИН раз (createDrumStage); на каждом событии звука меняется только
// содержимое слотов рук, подписи и атрибуты data-*. Барабан не пересоздаётся и не
// двигается: слоты рук занимают место всегда (скрыты через visibility), поэтому смена
// руки, пауза, темп и поворот экрана не сдвигают барабан. Анимация одного касания — чистый
// CSS у только что созданного элемента руки: таймеров нет, после «Пауза»/«Стоп» нечему
// сработать позже. Разметка — чистые функции (tests/drum-stage.test.js).
import { handSvg, sideHandSvg, mridangaSvg, timbreSvg, fingerWords } from './hand.js?v=0.3.2';
import { timbreInfo, laneWords } from '../model/display.js?v=0.3.0';
import { hitOf, sideMark } from '../model/drum-cue.js?v=0.3.3';
import { cueHint } from './stage.js?v=0.3.2';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Каркас сцены. */
export function drumStageHtml() {
  return `<div class="dstage" data-el="dstage" data-mode="preview" data-kind="empty" role="group" aria-label="Барабан, сейчас и два следующих удара">
    <div class="ds-cue">
      <div class="ds-head" data-el="head"></div>
      <div class="ds-hint" data-el="hint"></div>
      <div class="ds-timbre" data-el="timbre"></div>
    </div>
    <div class="ds-scene">
      <div class="ds-hand ds-left" data-el="left" data-side="left" data-active="0"></div>
      <div class="ds-drum" data-el="drum" data-hit="">${mridangaSvg()}<span class="ds-syl" data-el="syl"></span></div>
      <div class="ds-hand ds-right" data-el="right" data-side="right" data-active="0"></div>
    </div>
    <div class="ds-next" data-el="next" role="group" aria-label="Следующие удары"></div>
  </div>`;
}

/** Рука в слоте: подробная схема или только сторона. Пусто — слот скрыт, но место занято. */
export function handSlotHtml(h, timbre = null) {
  if (!h) return '';
  const lw = laneWords(h.side);
  if (h.mode === 'detail' && h.hand) {
    const words = fingerWords(h.hand);
    return `<div class="ds-hand-in" data-mode="detail">${handSvg(h.hand, { lane: h.side, size: 84, timbre })}
      <span class="ds-lane">${esc(lw.long)}</span>${words ? `<span class="ds-fingers">${esc(words)}</span>` : ''}</div>`;
  }
  return `<div class="ds-hand-in" data-mode="side">${sideHandSvg({ lane: h.side, size: 84, timbre })}
    <span class="ds-lane">${esc(lw.long)}</span></div>`;
}

/** Бейдж тембра словом и значком; неизвестный — нейтральное «Удар». */
export function timbreHtml(t) {
  const info = timbreInfo(t);
  return `<span class="sc-timbre" data-timbre="${info.id}">${timbreSvg(info.id, 22)}<span>${esc(info.word)}</span></span>`;
}

/** Текст приёма под слогом: подробный — только у подтверждённого приёма, иначе только сторона. */
export function hintOf(view) {
  if (!view) return '';
  if (view.kind === 'rest') return 'Пауза';
  const g = cueHint(view.cue);
  if (g) return g;
  const sides = ['left', 'right'].filter((s) => view.hands[s]);
  if (sides.length === 2) return 'Обе руки вместе';
  return sides.length ? `${laneWords(sides[0]).short} рука` : '';
}

/** Две маленькие подсказки: «Далее» и «Потом». */
export function nextHtml(items) {
  return items.map(({ head, view }) => {
    if (view === 'end') return `<div class="dn dn-end" data-slot="${head.id}"><span class="dn-head">${esc(head.text)}</span><b class="dn-syl" aria-label="конец">■</b></div>`;
    if (!view) return `<div class="dn dn-empty" data-slot="${head.id}"></div>`;
    if (view.kind === 'rest') return `<div class="dn dn-rest" data-slot="${head.id}"><span class="dn-head">${esc(head.text)}</span><b class="dn-syl">—</b><i class="dn-side">пауза</i></div>`;
    const mark = sideMark(view);
    const words = mark === 'Л+П' ? 'обе руки' : mark === 'Л' ? 'левая рука' : mark === 'П' ? 'правая рука' : '';
    const previewHands = ['left', 'right'].map(side => view.hands[side]).filter(Boolean).map(h =>
      h.mode === 'detail' && h.hand
        ? handSvg(h.hand, { lane: h.side, size: 36, timbre: view.timbre })
        : sideHandSvg({ lane: h.side, size: 36, timbre: view.timbre })).join('');
    return `<div class="dn" data-slot="${head.id}"${view.accent ? ' data-accent="1"' : ''}${mark ? ` data-side="${esc(mark)}"` : ''}>`
      + `<span class="dn-head">${esc(head.text)}</span><b class="dn-syl">${esc(view.label)}</b>`
      + `${mark ? `<i class="dn-side" aria-label="${words}">${esc(mark)}</i>` : ''}${previewHands ? `<span class="dn-gestures">${previewHands}</span>` : ''}</div>`;
  }).join('');
}

const NEXT_HEADS = [{ id: 'next', text: 'Далее' }, { id: 'then', text: 'Потом' }];

/**
 * Смонтировать сцену в root (один раз) и вернуть управление ею.
 * @param {{innerHTML: string, querySelector: (s: string) => any}} root
 */
export function createDrumStage(root) {
  root.innerHTML = drumStageHtml();
  const el = (k) => root.querySelector(`[data-el="${k}"]`);
  const n = {
    stage: el('dstage'), head: el('head'), syl: el('syl'), hint: el('hint'), timbre: el('timbre'),
    left: el('left'), right: el('right'), drum: el('drum'), next: el('next'),
  };
  return {
    hold() { n.stage.setAttribute('data-mode', 'paused'); },
    /**
     * @param {object|'end'|null} view drumCue события или null
     * @param {{mode?: 'live'|'paused'|'preview', head?: string, next?: Array<object|'end'|null>}} [o]
     *   live — удар по часам звука (CSS-пульс); paused — тот же удар на паузе (без пульса);
     *   preview — первый удар до старта и после «Стоп» (подписан, без пульса)
     */
    show(view, { mode = 'live', head = '', next = [] } = {}) {
      const stroke = view && view !== 'end' && view.kind === 'stroke';
      const rest = view && view !== 'end' && view.kind === 'rest';
      n.stage.setAttribute('data-mode', mode);
      n.stage.setAttribute('data-kind', stroke ? 'stroke' : rest ? 'rest' : 'empty');
      n.stage.setAttribute('data-accent', stroke && view.accent ? '1' : '0');
      n.head.textContent = stroke && view.accent ? `${head} · акцент` : head;
      n.syl.textContent = stroke ? view.label : rest ? '—' : '';
      n.hint.textContent = stroke || rest ? hintOf(view) : '';
      n.timbre.innerHTML = stroke ? timbreHtml(view.timbre) : '';
      for (const side of ['left', 'right']) {
        const h = stroke ? view.hands[side] : null;
        n[side].innerHTML = handSlotHtml(h, stroke ? view.timbre : null);
        n[side].setAttribute('data-active', h ? '1' : '0');
      }
      n.drum.setAttribute('data-hit', stroke ? hitOf(view) : '');
      n.next.innerHTML = nextHtml(NEXT_HEADS.map((head, i) => ({ head, view: next[i] ?? null })));
    },
  };
}
