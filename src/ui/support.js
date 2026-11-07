// Экран «Техподдержка» (0.3.6): быстрые темы, вопрос, подсказка из списка, ответ Qwen
// по явной просьбе и передача человеку через публичное обращение на GitHub.
// Сеть — только через askQwen и только после явного нажатия; при наборе и выборе темы её нет.
// Текст пользователя попадает в страницу через textContent; innerHTML не используется.
// Ничего не сохраняется: черновик живёт, пока открыт экран.
import { articles, instant, askQwen } from '../model/support.js?v=0.3.8';

const MAX = 450;
const ISSUE_URL = 'https://github.com/PrabhuArjun/mridanga-web/issues/new';
const TOPICS = [
  { id: 'sound', label: 'Нет звука' },
  { id: 'tempo', label: 'Темп' },
  { id: 'pause', label: 'Пауза' },
];

function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
}

/** Статья из ответа транспорта: только строки, ссылка — только внутренний маршрут #/… */
function cleanArticle(a) {
  if (!a || typeof a !== 'object') return null;
  const answer = typeof a.answer === 'string' ? a.answer.trim() : '';
  if (!answer) return null;
  const route = typeof a.href === 'string' && a.href.length <= 120 && (a.href==='/eight/' || /^#\/[\w\-./]*$/.test(a.href)) ? a.href : '';
  return {
    id: String(a.id ?? ''),
    title: typeof a.title === 'string' ? a.title.trim() : '',
    answer,
    href: route,
    label: route && typeof a.label === 'string' && a.label.trim() ? a.label.trim() : 'Открыть раздел',
  };
}

function topicArticle(id) {
  const list = Array.isArray(articles) ? articles : [];
  return list.find((a) => a?.id === id) ?? list.find((a) => typeof a?.id === 'string' && a.id.includes(id)) ?? null;
}

/** Адрес нового обращения с готовым текстом; иное, чем github.com/PrabhuArjun/mridanga-web, не открывается. */
function issueUrl(text) {
  const body = text.trim().slice(0, MAX);
  if (!body) return null;
  try {
    const u = new URL(ISSUE_URL);
    u.search = `?body=${encodeURIComponent(body)}`;
    return u.origin === 'https://github.com' && u.pathname === '/PrabhuArjun/mridanga-web/issues/new' ? u.href : null;
  } catch { return null; }
}

/** Смонтировать экран в el; вернуть уборку (отмена запроса при уходе со страницы). */
export function setupSupport(el) {
  let mode = 'ask';        // ask | loading | result | unknown | error | handoff
  let before = 'ask';      // откуда открыли «Передать человеку»
  let draft = '';          // текст в поле вопроса
  let question = '';       // вопрос, по которому показан результат
  let shown = null;        // {article, source: 'faq' | 'qwen'}
  let errorKind = 'down';  // down | offline
  let handoffText = '';
  let seq = 0;
  let ctl = null;
  let disposed = false;

  const live = h('p', { class: 'vh', role: 'status', 'aria-live': 'polite' });
  const panel = h('div', { class: 'sp-panel' });
  el.replaceChildren(h('article', { class: 'card support-card' }, h('h1', { text: 'Техподдержка' }), panel, live));

  function cancelPending() {
    seq += 1;
    ctl?.abort();
    ctl = null;
  }

  function go(next, focus) {
    mode = next;
    render(focus);
  }

  function showFaq(article) {
    shown = { article, source: 'faq' };
    go('result', '[data-focus]');
  }

  function submit(text) {
    const q = text.trim().slice(0, MAX);
    if (!q) { go('ask', '#sp-q'); return; }
    cancelPending();
    question = q;
    let hit = null;
    try { hit = cleanArticle(instant(q)); } catch { hit = null; }
    if (hit) showFaq(hit);
    else consult(q);
  }

  async function consult(q) {
    cancelPending();
    question = q;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      errorKind = 'offline';
      go('error', '[data-focus]');
      return;
    }
    const mine = seq;
    ctl = new AbortController();
    const signal = ctl.signal;
    go('loading', '[data-focus]');
    try {
      const list = await askQwen(q, signal);
      if (disposed || mine !== seq || signal.aborted) return;
      const found = (Array.isArray(list) ? list : []).map(cleanArticle).find(Boolean);
      if (found) { shown = { article: found, source: 'qwen' }; go('result', '[data-focus]'); }
      else go('unknown', '[data-focus]');
    } catch {
      if (disposed || mine !== seq || signal.aborted) return;
      errorKind = navigator.onLine === false ? 'offline' : 'down';
      go('error', '[data-focus]');
    }
  }

  function openHandoff() {
    cancelPending();
    before = mode === 'loading' ? 'ask' : mode === 'handoff' ? before : mode;
    handoffText = (mode === 'ask' ? draft : question || draft).slice(0,MAX);
    go('handoff', '[data-focus]');
  }

  function human() {
    return h('button', { type: 'button', class: 'link-btn sp-human', text: 'Передать человеку', onclick: openHandoff });
  }

  function editAgain() {
    draft = question || draft;
    go('ask', '#sp-q');
  }

  function counter(area, out) {
    const upd = () => { out.textContent = `${area.value.length} / ${MAX}`; };
    upd();
    return upd;
  }

  function askPanel() {
    const area = h('textarea', {
      id: 'sp-q', class: 'sp-text', rows: '2', maxlength: String(MAX), enterkeyhint: 'send',
      autocomplete: 'off', autocapitalize: 'sentences',
    });
    area.value = draft;
    const count = h('span', { class: 'sp-count' });
    const upd = counter(area, count);
    area.addEventListener('input', () => { draft = area.value; upd(); });
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(area.value); }
    });
    const topics = TOPICS.map((t) => ({ ...t, article: topicArticle(t.id) })).filter((t) => t.article);
    return [
      topics.length && h('div', { class: 'sp-topics', role: 'group', 'aria-label': 'Быстрые темы' },
        ...topics.map((t) => h('button', {
          type: 'button', text: t.label,
          onclick: () => {
            const a = cleanArticle(t.article);
            if (!a) return;
            cancelPending();
            question = a.title;
            showFaq(a);
          },
        }))),
      h('form', { class: 'sp-form', onsubmit: (e) => { e.preventDefault(); submit(area.value); } },
        h('label', { class: 'sp-label', for: 'sp-q', text: 'Ваш вопрос' }),
        area,
        h('div', { class: 'sp-row' }, count, h('button', { type: 'submit', class: 'primary', text: 'Спросить' }))),
      h('p', { class: 'small muted', text: 'Если подсказки нет, вопрос получит наша Qwen. Не пишите личные данные.' }),
      human(),
    ];
  }

  function resultPanel() {
    const { article, source } = shown;
    const sub = h('section', { class: 'sp-answer', 'aria-label': source === 'qwen' ? 'Ответ Qwen' : 'Подсказка' },
      h('span', { class: 'chip', text: source === 'qwen' ? 'Ответ Qwen' : 'Подсказка' }),
      article.title && h('h2', { tabindex: '-1', 'data-focus': '', text: article.title }),
      h('p', { text: article.answer }),
      article.href && h('a', { class: 'btn', href: article.href, text: article.label }));
    if (!article.title) sub.querySelector('p').setAttribute('data-focus', '');
    const noFocus = !sub.querySelector('[data-focus]');
    if (noFocus) { sub.setAttribute('tabindex', '-1'); sub.setAttribute('data-focus', ''); }
    return [
      question && h('p', { class: 'sp-q', text: `Вопрос: ${question}` }),
      sub,
      h('div', { class: 'sp-actions' },
        source === 'faq' && h('button', { type: 'button', text: 'Спросить Qwen', onclick: () => consult(question) }),
        h('button', { type: 'button', text: 'Новый вопрос', onclick: () => { draft = ''; question = ''; go('ask', '#sp-q'); } })),
      human(),
    ];
  }

  function statusPanel(title, text, actions) {
    return [
      question && h('p', { class: 'sp-q', text: `Вопрос: ${question}` }),
      h('h2', { tabindex: '-1', 'data-focus': '', text: title }),
      h('p', { text }),
      h('div', { class: 'sp-actions' }, ...actions),
    ];
  }

  function handoffPanel() {
    const area = h('textarea', {
      id: 'sp-h', class: 'sp-text', rows: '2', maxlength: String(MAX), autocomplete: 'off',
    });
    area.value = handoffText;
    const count = h('span', { class: 'sp-count' });
    const upd = counter(area, count);
    const note = h('p', { class: 'sp-note small', role: 'status' });
    const open = h('a', {
      class: 'btn primary', target: '_blank', rel: 'noopener noreferrer', text: 'Открыть GitHub',
      onclick: (e) => {
        if (!issueUrl(area.value)) { e.preventDefault(); return; }
        note.textContent = 'Страница GitHub открыта. Обращение не отправлено: оно появится, только если вы сами отправите его на GitHub.';
      },
    });
    const sync = () => {
      handoffText = area.value;
      const url = issueUrl(area.value);
      if (url) { open.setAttribute('href', url); open.removeAttribute('aria-disabled'); }
      else { open.removeAttribute('href'); open.setAttribute('aria-disabled', 'true'); }
      upd();
    };
    area.addEventListener('input', () => { note.textContent = ''; sync(); });
    sync();
    return [
      h('h2', { tabindex: '-1', 'data-focus': '', text: 'Передать человеку' }),
      h('p', { text: 'На GitHub нужен аккаунт. Сообщение станет публичным, когда вы сами его отправите.' }),
      h('label', { class: 'sp-label', for: 'sp-h', text: 'Текст обращения' }),
      area,
      h('p', { class: 'small muted', text: 'Не указывайте личные данные.' }),
      h('div', { class: 'sp-row' }, count),
      note,
      h('div', { class: 'sp-actions' }, open,
        h('button', { type: 'button', text: 'Назад', onclick: () => go(before === 'handoff' ? 'ask' : before, before === 'ask' ? '#sp-q' : '[data-focus]') })),
    ];
  }

  function render(focus) {
    panel.dataset.mode = mode;
    let parts;
    let say = '';
    if (mode === 'loading') {
      say = 'Ищу ответ…';
      parts = [
        question && h('p', { class: 'sp-q', text: `Вопрос: ${question}` }),
        h('p', { class: 'sp-wait', tabindex: '-1', 'data-focus': '' }, h('span', { class: 'sp-spin', 'aria-hidden': 'true' }), 'Ищу ответ…'),
        h('div', { class: 'sp-actions' },
          h('button', { type: 'button', text: 'Отмена', onclick: () => { cancelPending(); go('ask', '#sp-q'); } }), human()),
      ];
    } else if (mode === 'result') {
      say = shown.source === 'qwen' ? 'Ответ Qwen готов' : 'Подсказка готова';
      parts = resultPanel();
    } else if (mode === 'unknown') {
      say = 'Уверенного ответа нет';
      parts = statusPanel('Не нашлось уверенного ответа',
        'Попробуйте сказать иначе или передайте вопрос человеку.',
        [h('button', { type: 'button', class: 'primary', text: 'Передать человеку', onclick: openHandoff }),
          h('button', { type: 'button', text: 'Изменить вопрос', onclick: editAgain })]);
    } else if (mode === 'error') {
      const off = errorKind === 'offline';
      say = off ? 'Нет подключения' : 'Ответ недоступен';
      parts = statusPanel(off ? 'Нет подключения' : 'Ответ сейчас недоступен',
        off ? 'Подсказки из быстрых тем работают и без интернета. Для вопроса к Qwen нужна сеть.'
          : 'Сервис не ответил или не успел. Повторите позже или передайте вопрос человеку.',
        [h('button', { type: 'button', class: 'primary', text: 'Повторить', onclick: () => consult(question) }),
          h('button', { type: 'button', text: 'Передать человеку', onclick: openHandoff }),
          h('button', { type: 'button', text: 'Изменить вопрос', onclick: editAgain })]);
    } else if (mode === 'handoff') {
      say = 'Передать человеку';
      parts = handoffPanel();
    } else {
      parts = askPanel();
    }
    panel.replaceChildren(...parts.filter(Boolean));
    live.textContent = say;
    if (focus) panel.querySelector(focus)?.focus({ preventScroll: false });
  }

  render();

  return () => {
    disposed = true;
    cancelPending();
  };
}
