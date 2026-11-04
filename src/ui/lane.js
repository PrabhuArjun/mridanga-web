// Лента предстоящих ударов. Два вида:
//  - «Лента»: карточки едут справа налево мимо неподвижной отметки «Сейчас»;
//  - «Без движения»: три неподвижные карточки «Сейчас / Далее / Потом».
// Что показывать, решает план воспроизведения (audio/transport.js): лента не
// ведёт своего времени — ей передают позицию, вычисленную по часам звука.
import { cueWindow, eventBySeq } from '../audio/transport.js';
import { handSvg } from './hand.js?v=0.2.3';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LANE_SHORT = { right: 'П · малая', left: 'Л · большая', unknown: '' };

/**
 * Геометрия движущейся ленты: ширина карточки и место отметки так, чтобы
 * целиком помещались текущая и минимум две следующие (цель — три).
 * @param {number} width ширина ленты, px
 * @returns {{card: number, gap: number, marker: number, ahead: number}}
 */
export function laneGeometry(width, { gap = 6, min = 62, max = 128 } = {}) {
  // Отметка «Сейчас» — примерно в левой трети; слева от неё место для прошедшего удара.
  for (const ahead of [3, 2]) {
    const card = Math.min(max, Math.floor((width * 0.74 - ahead * gap) / (ahead + 0.5)));
    if (card >= min || ahead === 2) {
      const right = card / 2 + ahead * (card + gap);
      const marker = Math.max(card / 2 + 2, Math.min(width * 0.36, width - right - 2));
      return { card, gap, marker, ahead };
    }
  }
  return null; // недостижимо: цикл всегда возвращает при ahead = 2
}

/** HTML одной карточки. state: past | now | next | end | start */
export function cueCardHtml(cue, state, { compact = false } = {}) {
  const stateText = { past: 'звучал по записи', now: 'сейчас', next: 'далее', end: '', start: '' }[state];
  if (state === 'end') return `<div class="cue cue-end" data-state="end"><div class="cue-syl">■</div><div class="cue-hint">конец упражнения</div></div>`;
  if (state === 'start') return `<div class="cue cue-start" data-state="start"><div class="cue-syl">▶</div><div class="cue-hint">старт по кнопке</div></div>`;
  if (!cue) return '<div class="cue cue-empty"></div>';
  // Акцент заменяет слово состояния: где «сейчас», видно по отметке/колонке, а две
  // надписи в одну строку узкой карточки не помещаются.
  const head = cue.accent
    ? `<div class="cue-state"><b class="cue-accent" title="акцент; ${esc(stateText)}">&gt; акцент</b></div>`
    : `<div class="cue-state">${esc(stateText)}</div>`;
  if (cue.kind === 'rest') {
    return `<div class="cue cue-rest" data-state="${state}" data-kind="rest">${head}<div class="cue-syl">—</div><div class="cue-hint">пауза</div></div>`;
  }
  const tentative = false;
  // Одновременный удар: две схемы рядом — меньше и с короткой подписью руки, чтобы влезть в узкую карточку.
  const size = cue.together ? 24 : compact ? 30 : 36;
  const laneText = (p) => (cue.together ? (LANE_SHORT[p.lane] ?? p.lane).split(' · ')[0] : (LANE_SHORT[p.lane] ?? p.lane));
  const hands = cue.parts.map((p) => `<span class="cue-part">${handSvg(p.hand, { lane: p.lane, tentative: tentative || p.hand.status !== 'confirmed', size })}<span class="cue-lane">${esc(laneText(p))}</span></span>`).join(cue.together ? '<span class="cue-plus" aria-label="одновременно">+</span>' : '');
  // На карточке — краткая подпись (hand.short), сохраняющая приём и порядок движений;
  // полная — в словаре «Удары» и во всплывающей подсказке карточки.
  const handsOf = cue.combos.length ? cue.combos.map((c) => c.hand ?? { hint: c.label }) : cue.parts.map((p) => p.hand);
  const hint = handsOf.map((h) => h.short ?? h.hint).join('; ');
  const full = handsOf.map((h) => h.hint).join('; ');
  return `<div class="cue${tentative ? ' tentative' : ''}" data-state="${state}" data-kind="stroke"${cue.together ? ' data-together="1"' : ''}${cue.accent ? ' data-accent="1"' : ''} title="${esc(`${cue.label}: ${full}`)}">
    ${head}
    <div class="cue-syl">${esc(cue.label)}</div>
    <div class="cue-hands">${hands}</div>
    <div class="cue-hint">${esc(hint)}</div>
  </div>`;
}

/**
 * @param {HTMLElement} root контейнер ленты
 * @param {(slotIndex: number) => object} cueFor подсказка для поддоли рисунка
 */
export function createLane(root, cueFor) {
  let mode = 'moving';
  let plan = null;
  let pos = -1;
  let geo = null;
  const cards = new Map(); // seq → элемент (движущийся вид)

  root.innerHTML = `
    <div class="lane-moving" aria-hidden="false">
      <div class="lane-marker"><span>Сейчас</span></div>
      <div class="lane-track"></div>
    </div>
    <div class="lane-static" hidden>
      <div class="lane-col"><div class="lane-col-h">Сейчас</div><div class="lane-slot" data-col="now"></div></div>
      <div class="lane-col"><div class="lane-col-h">Далее</div><div class="lane-slot" data-col="next"></div></div>
      <div class="lane-col"><div class="lane-col-h">Потом</div><div class="lane-slot" data-col="then"></div></div>
    </div>`;
  const moving = root.querySelector('.lane-moving');
  const track = root.querySelector('.lane-track');
  const marker = root.querySelector('.lane-marker');
  const stat = root.querySelector('.lane-static');

  const cueOf = (seq) => {
    const ev = plan && eventBySeq(plan, seq);
    return ev ? { ev, cue: cueFor(ev.slotIndex) } : null;
  };

  function layout() {
    const w = moving.clientWidth;
    if (!w) return;
    geo = laneGeometry(w);
    root.style.setProperty('--cue-w', `${geo.card}px`);
    marker.style.left = `${geo.marker}px`;
    cards.forEach((el) => el.remove());
    cards.clear();
  }

  function stateOf(seq) {
    const cur = Math.floor(pos + 1e-6);
    if (seq < cur) return 'past';
    return seq === cur ? 'now' : 'next';
  }

  function renderMoving() {
    if (!geo) layout();
    if (!geo) return;
    const cur = Math.floor(pos + 1e-6);
    const from = cur - 2;
    const to = cur + geo.ahead + 2;
    for (const [seq, el] of cards) {
      if (seq < from || seq > to) { el.remove(); cards.delete(seq); }
    }
    const step = geo.card + geo.gap;
    for (let seq = from; seq <= to; seq++) {
      const kind = seq < 0 ? (seq === -1 ? 'start' : null) : (cueOf(seq) ? 'cue' : (cueOf(seq - 1) || seq === 0 ? 'end' : null));
      if (!kind) continue;
      const state = kind === 'cue' ? stateOf(seq) : kind;
      let el = cards.get(seq);
      if (!el || el.dataset.st !== state) {
        // В узкой карточке (375 px и уже при трёх следующих) схема кисти меньше — место для подписи.
        const html = kind === 'cue' ? cueCardHtml(cueOf(seq).cue, state, { compact: geo.card < 72 }) : cueCardHtml(null, state);
        const box = document.createElement('div');
        box.className = 'lane-card';
        box.dataset.seq = String(seq);
        box.dataset.st = state;
        box.innerHTML = html;
        if (el) el.replaceWith(box); else track.append(box);
        el = box;
        cards.set(seq, el);
      }
      const x = geo.marker + (seq - pos) * step - geo.card / 2;
      el.style.transform = `translateX(${x.toFixed(1)}px)`;
    }
  }

  function renderStatic() {
    const cur = Math.floor(pos + 1e-6);
    const put = (col, seq) => {
      const slot = stat.querySelector(`[data-col="${col}"]`);
      let html;
      if (seq < 0) html = cueCardHtml(null, 'start');
      else {
        const c = cueOf(seq);
        html = c ? cueCardHtml(c.cue, col === 'now' ? 'now' : 'next', { compact: true })
          : (cueOf(seq - 1) || seq === 0 ? cueCardHtml(null, 'end') : cueCardHtml(null, 'empty'));
      }
      slot.innerHTML = html;
      slot.dataset.seq = String(seq);
    };
    put('now', cur);
    put('next', cur + 1);
    put('then', cur + 2);
  }

  const api = {
    /** Позиция: seq текущего события (+ доля пути до следующего); −1 — до старта. */
    setPosition(p) {
      pos = p;
      if (mode === 'moving') renderMoving(); else renderStatic();
    },
    setPlan(p) {
      plan = p;
      cards.forEach((el) => el.remove());
      cards.clear();
      api.setPosition(pos);
    },
    setMode(m) {
      mode = m;
      moving.hidden = m !== 'moving';
      stat.hidden = m !== 'static';
      root.dataset.mode = m;
      if (m === 'moving') layout();
      api.setPosition(pos);
    },
    relayout() { layout(); api.setPosition(pos); },
    get position() { return pos; },
    /** Что сейчас видно: для проверок «Сейчас» и следующих карточек. */
    visible() {
      const cur = Math.floor(pos + 1e-6);
      const w = cueWindow(plan, cur, { before: 1, after: 3 });
      return { cur, window: w };
    },
  };
  return api;
}
