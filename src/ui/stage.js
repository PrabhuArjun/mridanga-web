// Карточки ударов (0.3.0): крупная карточка текущего удара и две следующие.
// С 0.3.1 главную сцену практики рисует ui/drumstage.js (барабан и руки); отсюда
// приложение берёт только cueHint (подпись приёма), карточки остаются для проверки в
// tests/stage.test.js. Чистые функции разметки.
import { handSvg, drumSvg, timbreSvg, fingerWords } from './hand.js?v=0.3.2';
import { timbreInfo, laneWords } from '../model/display.js?v=0.3.0';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Краткая подпись приёма: у составного удара — его собственная, иначе у каждой руки. */
export function cueHint(cue) {
  if (!cue?.parts?.length) return '';
  const hands = cue.combos?.length ? cue.combos.map((c) => c.hand ?? { hint: c.label }) : cue.parts.map((p) => p.hand);
  return hands.map((h) => h.short ?? h.hint ?? '').filter(Boolean).join('; ');
}

function partHtml(p, size, withWords) {
  const lw = laneWords(p.lane);
  const words = withWords ? fingerWords(p.hand) : '';
  return `<span class="sc-part">${handSvg(p.hand, { lane: p.lane, size })}
    <span class="sc-lane">${esc(withWords ? lw.long : lw.short)}</span>${words ? `<span class="sc-fingers">${esc(words)}</span>` : ''}</span>`;
}

function timbreHtml(t, big) {
  const info = timbreInfo(t);
  return `<span class="sc-timbre" data-timbre="${info.id}">${timbreSvg(info.id, big ? 28 : 18)}<span>${esc(info.word)}</span></span>`;
}

/**
 * Одна карточка сцены.
 * @param {object|'end'|null} cue подсказка (practiceCue + timbre) или 'end' — упражнение закончится
 * @param {{slot?: 'now'|'next'|'then', head?: string}} [opts]
 */
export function stageCardHtml(cue, { slot = 'now', head = '' } = {}) {
  const big = slot === 'now';
  const top = `<div class="sc-head">${esc(head)}</div>`;
  if (cue === 'end') {
    return `<div class="sc sc-end" data-slot="${slot}">${top}<div class="sc-syl" aria-hidden="true">■</div><div class="sc-hint">Конец</div></div>`;
  }
  if (!cue) return `<div class="sc sc-empty" data-slot="${slot}">${top}</div>`;
  if (cue.kind === 'rest') {
    return `<div class="sc sc-rest" data-slot="${slot}" data-kind="rest">${top}<div class="sc-syl">—</div><div class="sc-hint">Пауза</div></div>`;
  }
  const many = cue.parts.length > 1;
  const size = big ? (many ? 92 : 132) : (many ? 34 : 46);
  const visual = cue.parts.length
    ? cue.parts.map((p) => partHtml(p, size, big)).join(many ? '<span class="sc-plus" aria-label="одновременно">+</span>' : '')
    : `<span class="sc-part">${drumSvg({ size: big ? 120 : 52 })}</span>`;
  const hint = big ? cueHint(cue) : '';
  return `<div class="sc" data-slot="${slot}" data-kind="stroke"${cue.accent ? ' data-accent="1"' : ''}${many ? ' data-together="1"' : ''}>
    ${top}
    ${cue.accent ? '<b class="sc-accent">&gt; акцент</b>' : ''}
    <div class="sc-syl">${esc(cue.label)}</div>
    <div class="sc-visual">${visual}</div>
    ${hint ? `<div class="sc-hint">${esc(hint)}</div>` : ''}
    ${timbreHtml(cue.timbre ?? null, big)}
  </div>`;
}

/**
 * Три карточки: сейчас, далее, потом.
 * @param {(seq: number) => (object|'end'|null)} cueAt подсказка события seq; 'end' — после последнего
 * @param {number} cur seq текущего события; −1 — до старта (тогда крупно — первый удар)
 */
export function stageHtml(cueAt, cur) {
  const first = cur < 0;
  const base = first ? 0 : cur;
  return `<div class="stage-now">${stageCardHtml(cueAt(base), { slot: 'now', head: first ? 'Первый удар' : 'Сейчас' })}</div>
    <div class="stage-next">
      ${stageCardHtml(cueAt(base + 1), { slot: 'next', head: 'Далее' })}
      ${stageCardHtml(cueAt(base + 2), { slot: 'then', head: 'Потом' })}
    </div>`;
}
