// Выбор темпа: компактная кнопка «60 уд/мин» открывает окно с цифрами, как при
// выборе даты (на телефоне каждая цифра — системное колесо), кнопками −/+ и
// заготовками. «Готово» применяет темп и закрывает окно; Esc — без изменений.
// Применение темпа (с ближайшего цикла во время игры) остаётся за вызывающим.

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 240;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function clampTempo(v, fallback = 60) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, n));
}

/** 128 → [1, 2, 8] */
export function tempoDigits(n) {
  const v = clampTempo(n);
  return [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10];
}

/** Цифры → темп в пределах 20…240. */
export function tempoFromDigits(h, t, u) {
  return clampTempo(Number(h) * 100 + Number(t) * 10 + Number(u));
}

export function tempoLabel(n) {
  return `${n} уд/мин`;
}

let seq = 0;

/**
 * Открыть окно выбора темпа.
 * @param {HTMLElement} host куда вставить окно (уходит вместе со страницей)
 * @param {{value: number, presets?: {label: string, value: number}[], note?: string, onDone: (n: number) => void, returnFocus?: HTMLElement}} p
 */
export function openTempoPicker(host, { value, presets = [], note = '', onDone, returnFocus = null }) {
  const id = `tp${++seq}`;
  const digit = (name, label, max) => `<label class="digit"><span class="digit-l">${label}</span>
    <select data-d="${name}" aria-label="${label}">${Array.from({ length: max + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join('')}</select></label>`;
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet tempo-sheet';
  dlg.setAttribute('aria-labelledby', `${id}h`);
  dlg.innerHTML = `<form method="dialog" class="sheet-body">
      <h2 id="${id}h" class="sheet-title">Темп</h2>
      <div class="tempo-wheel">
        <button type="button" class="round" data-step="-1" aria-label="Медленнее на 1">−</button>
        <div class="digits" role="group" aria-label="Цифры темпа">
          ${digit('h', 'Сотни', 2)}${digit('t', 'Десятки', 9)}${digit('u', 'Единицы', 9)}
        </div>
        <button type="button" class="round" data-step="1" aria-label="Быстрее на 1">+</button>
      </div>
      <p class="tempo-readout" aria-live="polite"><b data-out></b> ударов в минуту <span class="muted">(от ${TEMPO_MIN} до ${TEMPO_MAX})</span></p>
      ${presets.length ? `<div class="tempo-presets" role="group" aria-label="Готовые значения">${presets.map((p) =>
        `<button type="button" data-preset="${p.value}">${esc(p.label)}</button>`).join('')}</div>` : ''}
      ${note ? `<p class="sheet-note">${esc(note)}</p>` : ''}
      <div class="sheet-actions"><button type="submit" class="primary" value="done">Готово</button></div>
    </form>`;
  host.append(dlg);
  let cur = clampTempo(value);
  const sel = (d) => dlg.querySelector(`[data-d="${d}"]`);
  const out = dlg.querySelector('[data-out]');
  const show = (n) => {
    cur = clampTempo(n, cur);
    const [h, t, u] = tempoDigits(cur);
    sel('h').value = String(h); sel('t').value = String(t); sel('u').value = String(u);
    out.textContent = String(cur);
  };
  show(cur);
  dlg.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => show(tempoFromDigits(sel('h').value, sel('t').value, sel('u').value))));
  dlg.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => show(cur + Number(b.dataset.step))));
  dlg.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.preset))));
  let applied = false;
  dlg.querySelector('form').addEventListener('submit', () => { applied = true; });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (applied) onDone(cur);
    returnFocus?.focus?.();
  });
  showDialog(dlg);
  sel('t').focus();
  return dlg;
}

/** showModal, а где его нет — просто открыть (старые браузеры). */
export function showDialog(dlg) {
  if (typeof dlg.showModal === 'function') {
    try { dlg.showModal(); return; } catch { /* уже открыт или не в документе */ }
  }
  dlg.setAttribute('open', '');
}
