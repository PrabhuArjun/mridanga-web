// Общие элементы карточек: полоса вкладок с ограниченной шириной и стрелками,
// листалка страниц. Разметка — строки; поведение — bind*().

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Полоса вкладок. Лишние вкладки уходят вбок внутри полосы (стрелки ‹ ›),
 * а не вытягивают страницу вниз.
 * @param {{name: string, label: string, items: {id: string, label: string, note?: string}[], selected: string, controls?: string, size?: 'sm'|'md'}} p
 */
export function stripHtml({ name, label, items, selected, controls = '', size = 'md' }) {
  return `<div class="strip strip-${size}" data-strip="${esc(name)}">
    <button type="button" class="strip-arrow" data-dir="-1" aria-label="${esc(label)}: прокрутить назад" tabindex="-1">‹</button>
    <div class="strip-scroll" role="tablist" aria-label="${esc(label)}">${items.map((it) => {
      const on = it.id === selected;
      return `<button type="button" role="tab" class="tab" data-tab="${esc(it.id)}" aria-selected="${on}" tabindex="${on ? 0 : -1}"${controls ? ` aria-controls="${esc(controls)}"` : ''}>${esc(it.label)}${it.note ? `<span class="tab-note">${esc(it.note)}</span>` : ''}</button>`;
    }).join('')}</div>
    <button type="button" class="strip-arrow" data-dir="1" aria-label="${esc(label)}: прокрутить вперёд" tabindex="-1">›</button>
  </div>`;
}

/**
 * Поведение полосы: выбор по нажатию, ←/→/Home/End с клавиатуры, стрелки
 * прокрутки видны только при переполнении.
 * @param {HTMLElement} root
 * @param {string} name
 * @param {(id: string, viaKeyboard: boolean) => void} onSelect
 */
export function bindStrip(root, name, onSelect) {
  const strip = root.querySelector(`[data-strip="${name}"]`);
  if (!strip) return;
  const box = strip.querySelector('.strip-scroll');
  const tabs = [...box.querySelectorAll('[role="tab"]')];
  const arrows = strip.querySelectorAll('.strip-arrow');
  const sync = () => {
    const over = box.scrollWidth > box.clientWidth + 2;
    strip.classList.toggle('over', over);
    arrows[0].disabled = !over || box.scrollLeft <= 1;
    arrows[1].disabled = !over || box.scrollLeft + box.clientWidth >= box.scrollWidth - 1;
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => onSelect(t.dataset.tab, false));
    t.addEventListener('keydown', (e) => {
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
      if (j === null) return;
      e.preventDefault();
      const next = tabs[(j + tabs.length) % tabs.length];
      onSelect(next.dataset.tab, true);
    });
  });
  arrows.forEach((a) => a.addEventListener('click', () => {
    box.scrollBy({ left: Number(a.dataset.dir) * box.clientWidth * 0.8, behavior: reduced() ? 'auto' : 'smooth' });
  }));
  box.addEventListener('scroll', sync, { passive: true });
  const sel = box.querySelector('[aria-selected="true"]');
  if (sel) {
    // Выбранная вкладка видна: прокручиваем только полосу, не страницу
    // (.strip-scroll — position: relative, поэтому offsetLeft отсчитывается от неё).
    const l = sel.offsetLeft;
    if (l < box.scrollLeft || l + sel.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, l - (box.clientWidth - sel.offsetWidth) / 2);
    }
  }
  sync();
  requestAnimationFrame(sync);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (!strip.isConnected) ro.disconnect(); else sync(); });
    ro.observe(strip);
  }
}

/** Вернуть фокус на вкладку после перерисовки карточки. */
export function focusTab(root, name, id) {
  root.querySelector(`[data-strip="${name}"] [data-tab="${CSS.escape(id)}"]`)?.focus();
}

/**
 * Листалка: «‹ Предыдущий  2/5  Следующий ›».
 * @param {{index: number, total: number, prev?: string, next?: string, label?: string}} p index с нуля
 */
export function pagerHtml({ index, total, prev = 'Предыдущий', next = 'Следующий', label = 'Страницы' }) {
  return `<nav class="pager" aria-label="${esc(label)}">
    <button type="button" data-page="-1"${index <= 0 ? ' disabled' : ''}><span aria-hidden="true">‹</span> ${esc(prev)}</button>
    <span class="pager-n" aria-live="polite">${index + 1}/${total}</span>
    <button type="button" data-page="1"${index >= total - 1 ? ' disabled' : ''}>${esc(next)} <span aria-hidden="true">›</span></button>
  </nav>`;
}

export function bindPager(root, onMove) {
  root.querySelectorAll('.pager [data-page]').forEach((b) => b.addEventListener('click', () => onMove(Number(b.dataset.page))));
}

export const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Значки разделов (обводка, цвет текста). */
export function icon(name, size = 28) {
  const p = {
    play: '<path d="M8 5 L19 12 L8 19 Z"/>',
    book: '<path d="M4 5 Q8 3.5 12 6 Q16 3.5 20 5 V19 Q16 17.5 12 20 Q8 17.5 4 19 Z M12 6 V20"/>',
    hand: '<path d="M7 13 V7.5 a1.5 1.5 0 0 1 3 0 V12 V5.5 a1.5 1.5 0 0 1 3 0 V12 V6.5 a1.5 1.5 0 0 1 3 0 V12.5 V9 a1.5 1.5 0 0 1 3 0 V15 q0 6 -6 6 h-1 q-4 0 -6 -4 l-2.5 -4.5 a1.5 1.5 0 0 1 2.5 -1.5 Z"/>',
    chart: '<path d="M4 20 H20 M7 17 V11 M12 17 V6 M17 17 V13"/>',
    sound: '<path d="M4 9.5 H8 L13 5 V19 L8 14.5 H4 Z M16 9 q2 3 0 6 M18.5 6.5 q4 5.5 0 11"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11 V16.5 M12 7.6 V8"/>',
    home: '<path d="M4 11 L12 4.5 L20 11 M6.5 9.5 V19.5 H17.5 V9.5"/>',
    back: '<path d="M14.5 5.5 L8 12 L14.5 18.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5 V6 M12 18 V20.5 M3.5 12 H6 M18 12 H20.5 M6 6 L7.8 7.8 M16.2 16.2 L18 18 M6 18 L7.8 16.2 M16.2 7.8 L18 6"/>',
  }[name] ?? '';
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}
