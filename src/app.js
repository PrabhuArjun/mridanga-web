// Приложение: загрузка контента, оболочка (верхняя и нижняя панели), маршруты
// (#/…) и экраны-карточки. Без сборки и внешних библиотек: ES-модули прямо в браузере.
// Каждый раздел — один экран; длинное — листается страницами, а не прокручивается.
import {
  parsePattern, buildCycleTimeline, countStrokes, tempoLadder, slotLabel, beatBpmFromStrokeRate,
} from './model/notation.js';
import { validateContent } from './model/content.js';
import {
  normalizeProgress, recordRun, markRep, toggleLadderStep, setLessonDone, lessonSummary,
  exerciseProgress, emptyProgress,
} from './model/progress.js';
import { Player } from './audio/engine.js?v=0.3.1';
import { createPlan, eventBySeq } from './audio/transport.js';
import { buildSoundProfiles, FAMILY_INFO } from './audio/sound-profile.js?v=0.3.1';
import { createLane } from './ui/lane.js?v=0.3.2';
import { handSvg, drumSvg, timbreSvg } from './ui/hand.js?v=0.3.2';
import { techKey } from './model/cue.js';
import { practiceCue, drumCue } from './model/drum-cue.js?v=0.3.3';
import { METRONOME_MODES } from './audio/scheduler.js';
import { renderStaff } from './ui/staff.js';
import { followScrollLeft } from './ui/follow.js';
import { createPracticeRun } from './model/practice-run.js';
import { techniqueReliability } from './model/reliability.js';
import {
  spell, spellLesson, lessonTab, moduleTab, strokeTimbre, timbreInfo, trustedHand, laneWords, paginate,
} from './model/display.js?v=0.3.0';
import { SECTIONS, parseRoute, href, breadcrumb, backHref, bottomTabs } from './model/nav.js?v=0.3.7';
import { normalizeNarration, narrationFor } from './model/narration.js?v=0.3.0';
import { createNarrator } from './ui/narrator.js?v=0.3.0';
import { createDrumStage } from './ui/drumstage.js?v=0.3.3';
import { openTempoPicker, showDialog, clampTempo, tempoLabel } from './ui/tempo.js?v=0.3.0';
import {
  esc, stripHtml, bindStrip, focusTab, pagerHtml, bindPager, icon,
} from './ui/widgets.js?v=0.3.0';
import { setupSupport } from './ui/support.js?v=0.3.6';

const APP_VERSION = '0.3.7';
const KEYS = { overrides: 'mridanga.overrides.v1', progress: 'mridanga.progress.v1', last: 'mridanga.last.v1' };
const app = document.getElementById('app');
const topBar = document.getElementById('top');
const bottomBar = document.getElementById('bottom');
const player = new Player();

// Хранилище браузера может быть недоступно (приватный режим) — тогда всё
// работает, просто без сохранения.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* нет хранилища */ } },
};

let base = null;   // контент из content/*.json
let C = null;      // действующий контент (с правками преподавателя, если они прошли проверку)
let strokeMap = new Map();
let progress = normalizeProgress(store.get(KEYS.progress));
let overrideNotice = '';
let narration = new Map(); // озвучка из content/narration.json (может не быть)
// Последний выбор ученика: урок практики, шаг теории, удар, урок прогресса.
// Читается с проверкой по контенту — устаревший id молча заменяется первым.
let last = store.get(KEYS.last);
if (!last || typeof last !== 'object') last = {};
// Идущая практика (одна на страницу): end() записывает полные циклы и
// останавливает звук, checkpoint() записывает их, не останавливая.
let practice = null;

const PLAYER_VOLUME = 0.8;
let practiceVolume = PLAYER_VOLUME;

function endPractice() {
  practice?.end();
  practice = null;
  player.stop();
}

// Озвучка и звук упражнения не звучат одновременно: перед голосом практика
// останавливается (с записью полных циклов), перед практикой — голос.
let narrationUi = null;
const narrator = createNarrator({
  beforePlay: () => endPractice(),
  onChange: (state) => narrationUi?.(state),
});

function saveLast(patch) {
  last = { ...last, ...patch };
  store.set(KEYS.last, last);
}

async function loadJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

/** Необязательный файл: нет его или он испорчен — null, приложение работает без него. */
async function loadOptionalJson(path) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function loadContent() {
  const [config, strokesDoc, lessonsDoc, media, narr] = await Promise.all([
    loadJson('content/notation-config.json'), loadJson('content/strokes.json'),
    loadJson('content/lessons.json'), loadJson('content/media.json'), loadOptionalJson('content/narration.json'),
  ]);
  base = { config, strokes: strokesDoc.strokes, modules: lessonsDoc.modules, defaults: lessonsDoc.defaults, media };
  narration = normalizeNarration(narr);
  applyOverrides();
}

function applyOverrides() {
  const o = store.get(KEYS.overrides);
  const next = { ...base, ...(o ?? {}) };
  const errs = o ? validateContent(next) : [];
  if (errs.length) {
    overrideNotice = `Правки преподавателя из этого браузера не применены: ${errs.length} ошибок. Откройте «Для преподавателя».`;
    C = base;
  } else {
    overrideNotice = o ? 'Действуют правки преподавателя, сохранённые в этом браузере.' : '';
    C = next;
  }
  C = { ...C, modules: C.modules.map((m) => ({ ...m,
    title: spell(m.id === 'm5' ? 'Упражнение с метрономом' : m.title),
    lessons: m.lessons.map((l) => spellLesson(l.id === 'care'
      ? { ...l, title: 'Настройка и уход', summary: 'Настройка инструмента и комфорт во время игры.',
          steps: ['Для изменения натяжения мембран обратитесь к мастеру.', 'Следите за свободой движений и комфортом рук.'] }
      : l.id === 'note-kenana'
        ? { ...l, summary: 'Восемь слогов с басовыми акцентами на первом, четвёртом и седьмом ударах. Группировка: 3 + 3 + 2.' }
        : l)),
  })) };
  strokeMap = new Map(C.strokes.map((s) => [s.id, s]));
}

function saveProgress(p) {
  progress = p;
  store.set(KEYS.progress, p);
}

// ---------- контент: поиск и общие элементы ----------

function allLessons() {
  return C.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m })));
}
const practiceLessons = () => allLessons().filter((l) => l.exercises.length);
const findLesson = (id, list = allLessons()) => list.find((l) => l.id === id) ?? null;

function feelChip(feelId) {
  const f = C.config.feels?.find((x) => x.id === feelId);
  return f?.status === 'confirmed' ? `<span class="chip">${esc(f.label)}</span>` : '';
}

const parse = (ex) => parsePattern(ex.pattern, { strokes: C.strokes, subdivision: ex.subdivision, symbols: C.config.symbols });

/** Слоги упражнения крупными плашками по долям; длинное — первые max и «+N». */
function seqChips(ex, max = 12) {
  const r = parse(ex);
  if (r.errors.length) return '';
  let shown = 0;
  const beats = [];
  for (const beat of r.beats) {
    if (shown >= max) break;
    const chips = [];
    for (const slot of beat) {
      if (shown >= max) break;
      chips.push(`<span class="syl-chip${slot.accent ? ' acc' : ''}${slot.rest ? ' rest' : ''}">${esc(slotLabel(slot, strokeMap, '—'))}</span>`);
      shown += 1;
    }
    beats.push(`<span class="syl-beat">${chips.join('')}</span>`);
  }
  const more = r.slots.length - shown;
  return `<div class="seq" role="img" aria-label="Слоги: ${esc(r.slots.map((s) => slotLabel(s, strokeMap, 'пауза')).join(' '))}">${beats.join('')}${more > 0 ? `<span class="syl-more">+${more}</span>` : ''}</div>`;
}

/** Крупная фигура удара: слог, схема кисти (только подтверждённая) или общий значок, тембр. */
function strokeFigure(s, { size = 96 } = {}) {
  if (!s) return '';
  const combo = Boolean(s.combination?.length);
  const parts = combo ? s.combination.map((id) => strokeMap.get(id)) : [s];
  // Составной удар: сам подтверждён, без расхождений, и приём каждой руки подтверждён.
  const ok = combo
    ? s.status === 'confirmed' && !s.conflict && s.hand?.status === 'confirmed' && parts.every((p) => trustedHand(p))
    : Boolean(trustedHand(s));
  const visual = ok
    ? parts.map((p) => handSvg(trustedHand(p), { lane: p.lane, timbre: strokeTimbre(p, strokeMap), size: combo ? Math.round(size * 0.7) : size }))
      .join(combo ? '<span class="sc-plus" aria-label="одновременно">+</span>' : '')
    : drumSvg({ size: Math.round(size * 1.1) });
  const t = timbreInfo(strokeTimbre(s, strokeMap));
  return `<figure class="fig">
    <div class="fig-syl">${esc(s.label)}</div>
    <div class="fig-visual">${visual}</div>
    <figcaption><span class="sc-timbre" data-timbre="${t.id}">${timbreSvg(t.id, 20)}<span>${esc(t.word)}</span></span>${laneWords(s.lane).long ? ` <span class="muted">${esc(laneWords(s.lane).long)}</span>` : ''}</figcaption>
  </figure>`;
}

// A student should never be taught a disputed finger assignment as established.
// practiceCue / drumCue (model/drum-cue.js) keep the syllable and audio but omit
// that hand illustration.

/** Звуковые профили всех ударов; один и тот же для практики, «Послушать» и проверки звука. */
function soundMap() {
  // Составной удар («Так», «Дхин») звучит слоями своих составляющих (audio/sound-profile.js).
  return buildSoundProfiles(C.strokes);
}

function startFailureText() {
  return 'Браузер не включил звук. Нажмите ещё раз; на телефоне проверьте беззвучный режим.';
}

/** Синтезированный звук одного удара по кнопке «Послушать». */
function hearStroke(id, statusEl) {
  narrator.stop();
  endPractice();
  const r = parsePattern(id, { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols });
  player.start({
    plan: createPlan(buildCycleTimeline(r.beats, 60), { maxCycles: 1 }), strokeSounds: soundMap(), metronomeId: 'off', playStrokes: true,
  }).then((st) => { if (statusEl) statusEl.textContent = st === 'failed' ? startFailureText() : ''; });
}

// ---------- озвучка ----------

/** Кнопки озвучки — только если в манифесте есть запись. Иначе пусто: без нерабочей кнопки. */
function narrationHtml(track) {
  if (!track) return '';
  return `<div class="narr" data-narr>
    <button type="button" data-n="play">${icon('sound', 22)}<span>Слушать</span></button>
    <button type="button" data-n="pause" hidden>Ⅱ Пауза</button>
    <button type="button" data-n="stop" hidden>■ Стоп</button>
    <span class="narr-st small" role="status"></span>
  </div>`;
}

function bindNarration(root, track) {
  const box = root.querySelector('[data-narr]');
  if (!box || !track) { narrationUi = null; return; }
  const b = (n) => box.querySelector(`[data-n="${n}"]`);
  const st = box.querySelector('.narr-st');
  const render = (state) => {
    const mine = narrator.track?.src === track.src;
    const s = mine ? state : 'idle';
    b('play').hidden = s === 'playing' || s === 'failed';
    b('play').disabled = s === 'loading';
    b('play').querySelector('span').textContent = s === 'paused' ? 'Продолжить' : s === 'loading' ? 'Загрузка…' : 'Слушать';
    b('pause').hidden = s !== 'playing';
    b('stop').hidden = !(s === 'playing' || s === 'paused');
    st.textContent = s === 'failed' ? 'Запись сейчас недоступна — текст на карточке.' : '';
  };
  b('play').addEventListener('click', () => narrator.play(track));
  b('pause').addEventListener('click', () => narrator.pause());
  b('stop').addEventListener('click', () => narrator.stop());
  narrationUi = (state) => { if (box.isConnected) render(state); };
  render(narrator.state);
}

// ---------- оболочка: верхняя и нижняя панели ----------

function navButtons(back) {
  return `<a class="btn nav-btn" href="${esc(back)}">${icon('back', 22)}<span>Вернуться назад</span></a>
    <a class="btn nav-btn" href="#/">${icon('home', 22)}<span>Главное меню</span></a>`;
}

/**
 * Верхняя и нижняя панели страницы. На главном меню панелей нет — меню и есть навигация.
 * «Вернуться назад»/«Главное меню» текстом — только сверху; внизу разделы и «Меню».
 */
function setChrome(r, names = {}) {
  document.body.dataset.page = r.page;
  if (r.page === 'home') {
    topBar.innerHTML = '';
    bottomBar.innerHTML = '';
    topBar.hidden = true;
    bottomBar.hidden = true;
    return;
  }
  topBar.hidden = false;
  bottomBar.hidden = false;
  const trail = breadcrumb(r, names);
  const back = backHref(trail);
  topBar.innerHTML = `<div class="bar-row">${navButtons(back)}</div>
    <nav class="crumbs" aria-label="Путь"><ol>${trail.map((t, i) => {
      const lastOne = i === trail.length - 1;
      return `<li>${t.href && !lastOne ? `<a href="${esc(t.href)}">${esc(t.title)}</a>` : `<span${lastOne ? ' aria-current="page"' : ''}>${esc(t.title)}</span>`}</li>`;
    }).join('')}</ol></nav>`;
  bottomBar.innerHTML = `<nav class="tabbar" aria-label="Разделы и меню">${bottomTabs(r.page).map((t) =>
    `<a href="${esc(t.href)}"${t.current ? ' aria-current="page"' : ''}${t.id === 'home' ? ` aria-label="${esc(t.title)}"` : ''}>${icon(t.icon, 22)}<span>${esc(t.short)}</span></a>`).join('')}</nav>`;
}

/** Экран-карточка раздела. */
function screen(cls, inner) {
  app.innerHTML = `<section class="screen ${cls}">${inner}</section>`;
  return app.firstElementChild;
}

/**
 * Вернуть фокус после перерисовки карточки: ['tab', полоса, id] — на вкладку,
 * ['pager', ±1] — на ту же кнопку листалки (или на соседнюю, если эта стала недоступна).
 */
function restoreFocus(el, focus) {
  if (!focus) return;
  if (focus[0] === 'pager') {
    const want = el.querySelector(`.pager [data-page="${focus[1]}"]`);
    (want && !want.disabled ? want : el.querySelector(`.pager [data-page="${-focus[1]}"]`))?.focus();
  } else focusTab(el, focus[0], focus[1]);
}

// ---------- главное меню ----------

const eightBeats = {title:'Восемь долей, две группы', url:'/eight/'};

// One bookmark across the main course and the stand-alone eight-beat exercise.
// Only course destinations reconstructed from our catalog may become links.
const BOOKMARK = 'mridanga.study-place.v1';
let inMemoryPlace = null;
function rememberPlace(url) {
  inMemoryPlace = url;
  store.set(BOOKMARK, url);
}
function savedPlace() {
  const url = store.get(BOOKMARK) ?? inMemoryPlace;
  if (url === eightBeats.url) return url;
  if (typeof url === 'string' && url.startsWith('#/')) {
    const {page,a,b} = parseRoute(url);
    if (page === 'strokes' && strokeMap.has(a)) return href(page,a);
    if (page === 'theory') {
      const t = validTheory({lesson:a,step:Number(b)-1});
      if (t) return href(page,t.lesson.id,t.step+1);
    }
    if (page === 'lesson' || page === 'practice') {
      const p = validPractice({lesson:a,ex:b});
      if (p) return href(page,p.lesson.id,p.ex.id);
    }
  }
  // Older versions stored separate selections but no chronological order.
  const t = validTheory(last.theory);
  if (t) return href('theory',t.lesson.id,t.step+1);
  const p = validPractice(last.practice);
  if (p) return href('lesson',p.lesson.id,p.ex.id);
  return strokeMap.has(last.stroke) ? href('strokes', last.stroke) : null;
}

function viewHome() {
  setChrome({ page: 'home' });
  const resume = savedPlace();
  return screen('home', `
    <header class="home-head"><h1>Мриданга</h1></header>
    <nav class="tiles" aria-label="Главное меню">${SECTIONS.map((s) =>
      `<a class="tile" href="${href(s.id)}">${icon(s.icon,40)}<span>${esc(s.title)}</span></a>`).join('')}</nav>
    ${resume ? `<div class="home-actions"><a class="btn primary" href="${esc(resume)}">Продолжить изучение</a></div>` : ''}
    ${overrideNotice ? `<p class="note small">${esc(overrideNotice)}</p>` : ''}`);
}

function viewSupport(r) {
  setChrome(r);
  unmountView = setupSupport(screen('support', ''));
}

// ---------- выбор упражнения ----------

function validPractice(p) {
  const lesson = findLesson(p?.lesson, practiceLessons());
  if (!lesson) return null;
  const ex = lesson.exercises.find((e) => e.id === p.ex) ?? lesson.exercises[0];
  return { lesson, ex };
}

function validTheory(t) {
  const lesson = findLesson(t?.lesson);
  if (!lesson) return null;
  const pages = theoryPages(lesson);
  const step = Number.isInteger(t.step) && t.step >= 0 && t.step < pages.length ? t.step : 0;
  return { lesson, step };
}

function viewPractice(r) {
  const lessons = practiceLessons();
  // «Вернуться назад» из тренировки ведёт на #/practice/<урок>: вариант — тот, что был выбран.
  const exFromLast = !r.b && last.practice?.lesson === r.a ? last.practice.ex : r.b;
  let sel = validPractice({ lesson: r.a, ex: exFromLast }) ?? validPractice(last.practice) ?? validPractice({ lesson: lessons[0].id });
  const modules = C.modules.filter((m) => m.lessons.some((l) => l.exercises.length));

  const fromEight = firstRoute && document.referrer && new URL(document.referrer).origin === location.origin
    && new URL(document.referrer).pathname === eightBeats.url;
  const leftExercise = document.body.dataset.page === 'lesson' || fromEight;
  let rendered = false;
  const render = (focus = null) => {
    const { lesson, ex } = sel;
    // Returning through the picker should not displace the exercise itself.
    if (rendered || !leftExercise) rememberPlace(href('practice',lesson.id,ex.id));
    rendered = true;
    saveLast({ practice: { lesson: lesson.id, ex: ex.id } });
    history.replaceState(null, '', href('practice', lesson.id, ex.id));
    setChrome(r, { lessonTitle: lessonTab(lesson) });
    const inModule = lesson.module.lessons.filter((l) => l.exercises.length);
    const p = exerciseProgress(progress, ex.id);
    const el = screen('pick', `
      <h1 class="vh">Практика</h1>
      ${stripHtml({ name: 'group', label: 'Группы мантр', size: 'sm', selected: lesson.module.id,
        items: modules.map((m) => ({ id: m.id, label: moduleTab(m) })) })}
      ${stripHtml({ name: 'lesson', label: 'Мантры', selected: lesson.id, controls: 'pick-panel',
        items: inModule.map((l) => ({ id: l.id, label: lessonTab(l) })) })}
      <div class="pick-panel card" id="pick-panel" role="tabpanel" aria-label="${esc(lessonTab(lesson))}">
        <div class="pick-title"><h2>${esc(lessonTab(lesson))}</h2>${feelChip(lesson.feel)}</div>
        ${lesson.exercises.length > 1 ? stripHtml({ name: 'ex', label: 'Вариант упражнения', size: 'sm', selected: ex.id,
          items: lesson.exercises.map((e) => ({ id: e.id, label: e.title })) }) : `<p class="pick-ex">${esc(ex.title)}</p>`}
        ${seqChips(ex, 8)}
      </div>
      <a class="eight-shortcut" href="${eightBeats.url}">${icon('hand', 18)}<span>${esc(eightBeats.title)}</span></a>
      <div class="pick-actions">
        <a class="btn primary big" href="${href('lesson', lesson.id, ex.id)}">${icon('play', 24)}<span>Начать</span></a>
        <a class="btn" href="${href('theory', lesson.id)}">${icon('book', 22)}<span>Теория</span></a>
      </div>`);
    bindStrip(el, 'group', (id, kb) => {
      const m = modules.find((x) => x.id === id);
      const first = m.lessons.find((l) => l.exercises.length);
      const keep = validPractice(last.byModule?.[id]);
      sel = keep && keep.lesson.module.id === id ? keep : validPractice({ lesson: first.id });
      render(kb ? ['group', id] : null);
    });
    bindStrip(el, 'lesson', (id, kb) => {
      sel = validPractice({ lesson: id });
      saveLast({ byModule: { ...(last.byModule ?? {}), [sel.lesson.module.id]: { lesson: id } } });
      render(kb ? ['lesson', id] : null);
    });
    bindStrip(el, 'ex', (id, kb) => {
      sel = validPractice({ lesson: sel.lesson.id, ex: id });
      render(kb ? ['ex', id] : null);
    });
    restoreFocus(el, focus);
  };
  render();
}

// ---------- тренировка ----------

function viewTraining(r) {
  const lesson = findLesson(r.a);
  if (!lesson) {
    setChrome(r, { exerciseTitle: 'Урок не найден' });
    screen('msg', `<h1>Урок не найден</h1><p><a class="btn" href="#/practice">Выбрать упражнение</a></p>`);
    return;
  }
  const ex = lesson.exercises.find((e) => e.id === r.b) ?? lesson.exercises[0];
  if (!ex) {
    setChrome(r, { lessonId: lesson.id, lessonTitle: lessonTab(lesson), exerciseTitle: 'Без упражнений' });
    screen('msg', `<h1>${esc(lesson.title)}</h1><p>В этом уроке нет ритмических упражнений.</p>
      <p><a class="btn" href="${href('theory', lesson.id)}">${icon('book', 22)}<span>Теория урока</span></a></p>`);
    return;
  }
  rememberPlace(href('lesson',lesson.id,ex.id));
  if (lesson.exercises.length) saveLast({ practice: { lesson: lesson.id, ex: ex.id } });
  setChrome(r, { lessonId: lesson.id, lessonTitle: lessonTab(lesson), exerciseTitle: ex.title });
  app.innerHTML = '<section class="screen trainer" id="trainer"></section>';
  mountTrainer(app.firstElementChild, ex, { lesson });
}

/**
 * Тренировка на весь экран: крупный текущий удар и два следующих, счётчики,
 * темп, «Играть/Продолжить», «Пауза», «Стоп». Реже нужное — в «Настройках».
 */
function mountTrainer(root, ex, { sandbox = false, lesson = null } = {}) {
  const parsed = parse(ex);
  if (parsed.errors.length) {
    root.innerHTML = `<p class="errors">${esc(parsed.errors.join('\n'))}</p>`;
    return;
  }
  const usedLanes = new Set(parsed.slots.flatMap((s) => s.strokes.flatMap((id) => {
    const st = strokeMap.get(id);
    return st?.combination ? st.combination.map((c) => strokeMap.get(c)?.lane) : [st?.lane];
  })));
  const lanes = C.config.lanes.filter((l) => l.id !== 'unknown' || usedLanes.has('unknown'))
    .map((l) => l.id === 'unknown' ? { ...l, label: 'Слоги' } : l);
  const defaults = C.defaults ?? { slowRate: 60, fastFactor: 2, ladder: { from: 30, to: 90, step: 10 } };
  const slow = clampTempo(ex.tempo?.slow ?? defaults.slowRate);
  const fast = clampTempo(slow * (defaults.fastFactor ?? 2));
  const ladderRates = tempoLadder(defaults.ladder.from, defaults.ladder.to, defaults.ladder.step);
  const perCycle = countStrokes(parsed.slots);
  // Подсказка для каждой поддоли рисунка — по удару события, а не по слогу.
  const tech = techniqueReliability(ex, lesson, parsed.slots, strokeMap);
  const cueCtx = {
    strokeMap, lanes: C.config.lanes, notes: ex.techniqueNotes ?? [],
    tech: new Map(tech.items.map((i) => [techKey(i), i])),
  };
  // Что показывать на событии: рука/стороны барабана и подробность схемы (model/drum-cue.js).
  const views = parsed.slots.map((slot, i) => drumCue({ ...slot, slotIndex: i }, cueCtx));

  // Настройки прогона (меняются в окне «Настройки», пока не играет).
  let rate = slow;
  let cyclesVal = '4';
  let metroVal = ex.ladder ? 'every1' : 'beat';
  let synth = true;
  const title = lesson ? lessonTab(lesson) : ex.title;

  root.innerHTML = `
    <div class="tr-head">
      <h1 class="tr-title">${esc(title)}${lesson && ex.title !== title ? `<span class="tr-sub">${esc(ex.title)}</span>` : ''}</h1>
      <span class="tr-state" data-el="state" role="status">Готово к игре</span>
      <button type="button" class="icon-btn" data-act="settings" aria-haspopup="dialog">${icon('gear', 22)}<span>Настройки</span></button>
    </div>
    <div class="stage-wrap">
      <div class="stage" data-el="stage"></div>
      <div class="cycle-bar" aria-hidden="true"><i data-el="cbar"></i></div>
      <p class="tr-msg" data-el="msg" aria-live="polite"></p>
    </div>
    <div class="tr-panel">
      <div class="tr-info">
        <div class="counter"><span>Удары</span><b data-el="c-strokes">0</b></div>
        <div class="counter"><span>Циклы</span><b data-el="c-cycles">0</b></div>
        <button type="button" class="tempo-btn" data-act="tempo" aria-haspopup="dialog"></button>
      </div>
      <div class="transport" role="group" aria-label="Воспроизведение">
        <button type="button" class="primary" data-act="play"></button>
        <button type="button" data-act="pause" disabled>Ⅱ Пауза</button>
        <button type="button" data-act="stop" disabled>■ Стоп</button>
      </div>
    </div>`;

  const $ = (k) => root.querySelector(`[data-el="${k}"]`);
  const act = (k) => root.querySelector(`[data-act="${k}"]`);
  // Каркас сцены (барабан, слоты рук) создаётся один раз; дальше меняется только содержимое.
  const stage = createDrumStage($('stage'));
  const cbar = $('cbar');
  const msg = $('msg');
  const play = act('play');
  const pause = act('pause');
  const stop = act('stop');
  const tempoBtn = act('tempo');

  const timelineAt = (n) => buildCycleTimeline(parsed.beats, beatBpmFromStrokeRate(n, ex.subdivision));
  // До старта сцена показывает первые удары из того же плана, по которому пойдёт звук.
  const previewPlan = () => createPlan(timelineAt(rate), { maxCycles: Number(cyclesVal), rate });
  let viewPlan = previewPlan();
  let cur = -1;
  let run = null;

  const viewAt = (seq) => {
    const ev = eventBySeq(viewPlan, seq);
    if (ev) return views[ev.slotIndex];
    return seq > 0 && eventBySeq(viewPlan, seq - 1) ? 'end' : null;
  };
  // До старта и после «Стоп» — подписанный предпросмотр первого удара; во время игры — удар,
  // на котором сыграл звук (рисуется из onStep, то есть по часам звука); на паузе сцена
  // замирает на этом ударе, а перерисовка (например, смена темпа) идёт в режиме «paused» без пульса.
  const renderStage = () => {
    const first = cur < 0;
    const base = first ? 0 : cur;
    stage.show(viewAt(base), {
      mode: first ? 'preview' : player.paused ? 'paused' : 'live',
      head: first ? 'Первый удар' : 'Сейчас', next: [viewAt(base + 1), viewAt(base + 2)],
    });
    const ev = cur >= 0 ? eventBySeq(viewPlan, cur) : null;
    cbar.style.width = ev ? `${((ev.slotIndex + 1) / parsed.slots.length) * 100}%` : '0%';
  };
  const showTempo = () => {
    tempoBtn.textContent = tempoLabel(rate);
    tempoBtn.setAttribute('aria-label', `Темп: ${rate} ударов в минуту. Изменить`);
  };
  showTempo();
  renderStage();

  const syncControls = () => {
    play.textContent = player.paused && run ? '▶ Продолжить' : '▶ Играть';
    play.disabled = Boolean(run) && !player.paused || player.starting;
    pause.disabled = !run || !player.playing || player.starting;
    stop.disabled = !run;
    $('state').textContent = !run ? 'Готово к игре' : player.starting ? 'Включаю звук…' : player.paused ? 'На паузе' : 'Играет';
  };
  syncControls();

  // Применить темп: до старта — к плану предпросмотра, во время игры и на паузе —
  // с ближайшей незапланированной границы цикла (тот же план, по которому звучит звук).
  const applyTempo = (v) => {
    rate = clampTempo(v, rate);
    showTempo();
    if (!run) {
      viewPlan = previewPlan();
      renderStage();
      msg.textContent = '';
      return;
    }
    const r = player.retime(timelineAt(rate), rate);
    if (r) {
      viewPlan = player.plan;
      renderStage();
      msg.textContent = `Темп ${rate} — с цикла ${r.cycle + 1}.`;
    } else {
      msg.textContent = `Новой границы цикла до конца нет: темп ${rate} будет при следующем запуске.`;
    }
  };
  tempoBtn.addEventListener('click', () => {
    const presets = [{ label: `Медленно ${slow}`, value: slow }, { label: `Быстро ×2 ${fast}`, value: fast }];
    if (ex.ladder) ladderRates.forEach((n) => presets.push({ label: String(n), value: n }));
    openTempoPicker(root, {
      value: rate, presets, onDone: applyTempo, returnFocus: tempoBtn,
      note: run ? 'Во время игры новый темп начнётся со следующего цикла.' : '',
    });
  });

  const highlight = (i) => {
    root.querySelectorAll('.slot-hl.cur').forEach((x) => x.classList.remove('cur'));
    if (i < 0) return;
    const cell = root.querySelector(`.slot-hl[data-slot="${i}"]`);
    const wrap = root.querySelector('.staff-wrap');
    if (!cell || !wrap) return;
    cell.classList.add('cur');
    // Прокручиваем только рамку записи, не страницу.
    const left = Number(cell.getAttribute('x'));
    const next = followScrollLeft(wrap, left, left + Number(cell.getAttribute('width')));
    if (next !== null) wrap.scrollLeft = next;
  };

  // Записать ещё не записанные полные циклы. Частичный цикл не засчитывается,
  // повторный вызов ничего не добавляет (см. model/practice-run.js).
  let refreshInfo = () => {};
  const commit = (close) => {
    const r = run?.take({ close });
    if (r && !sandbox) {
      saveProgress(recordRun(progress, ex.id, { ...r, at: new Date().toISOString() }));
      refreshInfo();
    }
  };
  const finish = () => {
    player.stop();
    commit(true);
    run = null;
    if (practice?.root === root) practice = null;
    cur = -1;
    viewPlan = previewPlan();
    syncControls();
    highlight(-1);
    $('c-strokes').textContent = '0';
    $('c-cycles').textContent = '0';
    msg.textContent = '';
    // Сцена возвращается к началу: первые удары следующего запуска.
    renderStage();
  };
  pause.addEventListener('click', () => {
    if (!run || !player.pause()) return;
    if (cur >= 0) stage.hold();
    commit(false);
    syncControls();
  });
  stop.addEventListener('click', () => {
    if (!run) return;
    player.stop();
    finish();
  });
  play.addEventListener('click', async () => {
    narrator.stop();
    if (run) {
      if (!player.paused || player.starting) return;
      const thisRun = run;
      const pending = player.resume();
      syncControls();
      const status = await pending;
      if (run !== thisRun) return;
      syncControls();
      if (status === 'failed') msg.textContent = startFailureText();
      else if (msg.textContent === startFailureText()) msg.textContent = '';
      return;
    }
    endPractice();
    const strokesPerMin = rate;
    const maxCycles = Number(cyclesVal);
    const plan = createPlan(timelineAt(strokesPerMin), { maxCycles, rate: strokesPerMin });
    run = createPracticeRun({
      slotsPerCycle: parsed.slots.length, strokesPerCycle: perCycle, rate: strokesPerMin, maxCycles,
    });
    practice = { root, end: finish, checkpoint: () => commit(false) };
    $('c-strokes').textContent = '0';
    $('c-cycles').textContent = '0';
    msg.textContent = '';
    viewPlan = plan;
    cur = -1;
    renderStage();
    const thisRun = run;
    player.setVolume(practiceVolume);
    const pending = player.start({
      plan, strokeSounds: soundMap(), metronomeId: metroVal, playStrokes: synth,
      onStep: (ev) => {
        if (run !== thisRun) return;
        // Первое событие нового темпа: циклы прежнего темпа записываются с прежним темпом.
        if (ev.rate !== run.rate) {
          commit(false);
          run.setRate(ev.rate);
        }
        if (ev.rate === rate && msg.textContent.startsWith('Темп ')) msg.textContent = '';
        run.step(ev);
        viewPlan = player.plan ?? viewPlan;
        cur = ev.seq;
        renderStage();
        highlight(ev.slotIndex);
        $('c-strokes').textContent = String(run.heard.strokes);
        $('c-cycles').textContent = String(run.heard.cycles);
      },
      onEnd: () => { if (run === thisRun) finish(); },
    });
    syncControls();
    const status = await pending;
    if (run !== thisRun) return; // за время ожидания нажали «Стоп» или ушли со страницы
    if (status !== 'started') {
      // Браузер отказал (или запуск отменён в обход этой кнопки): интерфейс — в исходное.
      finish();
      if (status === 'failed') msg.textContent = startFailureText();
      return;
    }
    syncControls();
  });

  // ----- окно «Настройки» -----
  act('settings').addEventListener('click', () => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet settings-sheet';
    dlg.setAttribute('aria-labelledby', 'set-h');
    const locked = Boolean(run);
    dlg.innerHTML = `<form method="dialog" class="sheet-body">
      <h2 id="set-h" class="sheet-title">Настройки упражнения</h2>
      ${stripHtml({ name: 'settings', label: 'Разделы настроек', selected: 'sound', items: [
        { id: 'sound', label: 'Звук' }, ...(!sandbox ? [{ id: 'progress', label: 'Прогресс' }] : []), { id: 'staff', label: 'Запись' },
      ] })}
      <div class="set-grid" data-set-panel="sound">
        ${locked ? '<p class="sheet-note set-lock">Для смены настроек нажмите «Стоп».</p>' : ''}
        <label>Повторять <select data-s="cycles"${locked ? ' disabled' : ''}>
          <option value="1">1 цикл</option><option value="2">2 цикла</option><option value="4">4 цикла</option>
          <option value="8">8 циклов</option><option value="Infinity">без остановки</option></select></label>
        <label>Метроном <select data-s="metro"${locked ? ' disabled' : ''}>${METRONOME_MODES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-s="synth"${synth ? ' checked' : ''}${locked ? ' disabled' : ''}> Звук ударов</label>
        <label>Громкость <input type="range" data-s="vol" min="0" max="100" value="${Math.round(practiceVolume * 100)}" aria-valuetext="${Math.round(practiceVolume * 100)}%"></label>
      </div>
      ${sandbox ? '' : `<div class="set-progress" data-set-panel="progress" hidden>
        <div class="row"><button type="button" data-s="rep">+1 повторение</button><span class="small muted" data-s="rep-info"></span></div>
        ${ex.ladder ? `<fieldset class="ladder"><legend class="small">Лестница темпа (самооценка)</legend>${ladderRates.map((n) =>
          `<label><input type="checkbox" data-step="${n}"> ${n}</label>`).join('')}</fieldset>` : ''}
        ${lesson ? `<label class="check"><input type="checkbox" data-s="done"${lessonSummary(progress, lesson).done ? ' checked' : ''}> Урок пройден (самооценка)</label>` : ''}
      </div>`}
      <div class="set-staff" data-set-panel="staff" hidden>
        <div class="staff-wrap">${renderStaff({ beats: parsed.beats, strokeMap, lanes, grouping: ex.grouping, title: `Запись: ${ex.title}` })}</div>
      </div>
      <div class="sheet-actions"><button type="submit" class="primary">Готово</button></div>
    </form>`;
    root.append(dlg);
    bindStrip(dlg, 'settings', (id, kb) => {
      dlg.querySelectorAll('[data-set-panel]').forEach(p => { p.hidden = p.dataset.setPanel !== id; });
      dlg.querySelectorAll('[data-tab]').forEach(b => { const selected = b.dataset.tab === id; b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; });
      if (kb) focusTab(dlg, 'settings', id);
    });
    const s = (k) => dlg.querySelector(`[data-s="${k}"]`);
    s('cycles').value = cyclesVal;
    s('metro').value = metroVal;
    s('cycles').addEventListener('change', () => {
      if (run) return;
      cyclesVal = s('cycles').value;
      viewPlan = previewPlan();
      renderStage();
    });
    s('metro').addEventListener('change', () => { if (!run) metroVal = s('metro').value; });
    s('synth').addEventListener('change', () => { if (!run) synth = s('synth').checked; });
    s('vol').addEventListener('input', () => {
      practiceVolume = Number(s('vol').value) / 100;
      s('vol').setAttribute('aria-valuetext', `${s('vol').value}%`);
      player.setVolume(practiceVolume);
    });
    if (!sandbox) {
      refreshInfo = () => {
        if (!dlg.isConnected) return;
        const p = exerciseProgress(progress, ex.id);
        s('rep-info').textContent = `отмечено: ${p.reps} · полных циклов: ${p.cycles} · лучший темп: ${p.bestRate || '—'}`;
        dlg.querySelectorAll('[data-step]').forEach((c) => { c.checked = Boolean(p.ladder[c.dataset.step]); });
      };
      refreshInfo();
      s('rep').addEventListener('click', () => { saveProgress(markRep(progress, ex.id, new Date().toISOString())); refreshInfo(); });
      dlg.querySelectorAll('[data-step]').forEach((c) => c.addEventListener('change', () => {
        saveProgress(toggleLadderStep(progress, ex.id, Number(c.dataset.step)));
      }));
      s('done')?.addEventListener('change', (e) => saveProgress(setLessonDone(progress, lesson.id, e.target.checked)));
    }
    dlg.addEventListener('close', () => {
      dlg.remove();
      refreshInfo = () => {};
      act('settings')?.focus();
    });
    showDialog(dlg);
  });
}

// ---------- теория ----------

/** Страницы урока: описание, затем по одному шагу; длинное делится на страницы. */
function theoryPages(lesson) {
  const pages = paginate(lesson.summary, 110).map((text) => ({ kind: 'summary', text }));
  (lesson.steps ?? []).forEach((s, i) => paginate(s, 110).forEach((text) => pages.push({ kind: 'step', n: i + 1, text })));
  if (!pages.length) pages.push({ kind: 'summary', text: lesson.title });
  return pages;
}

/** Удары, названные в тексте шага в «кавычках», среди ударов упражнений урока. */
function mentionedStrokes(text, lesson) {
  const used = [];
  for (const e of lesson.exercises) {
    const r = parse(e);
    r.slots.forEach((s) => s.strokes.forEach((id) => { if (!used.includes(id)) used.push(id); }));
  }
  const tokens = [...String(text).matchAll(/«([^»]+)»/g)].flatMap((m) => m[1].split(/\s+/));
  const out = [];
  for (const tok of tokens) {
    const id = used.find((u) => strokeMap.get(u)?.label.toLowerCase() === tok.toLowerCase())
      ?? C.strokes.find((s) => s.label.toLowerCase() === tok.toLowerCase())?.id;
    if (id && !out.includes(id)) out.push(id);
  }
  return { ids: out, tokens };
}

function theoryVisual(page, lesson, pages) {
  const ex = lesson.exercises[0];
  if (page.kind === 'step') {
    const { ids, tokens } = mentionedStrokes(page.text, lesson);
    if (ids.length && tokens.length <= 3) {
      return `<div class="figs" data-n="${ids.length}">${ids.slice(0, 3).map((id) => strokeFigure(strokeMap.get(id), { size: ids.length > 1 ? 80 : 110 })).join('')}</div>`;
    }
    if (tokens.length > 3) {
      return `<div class="seq">${tokens.map((t) => `<span class="syl-chip">${esc(t)}</span>`).join('')}</div>`;
    }
    const steps = pages.filter((p) => p.kind === 'step').length;
    return `<div class="step-badge" aria-hidden="true"><b>${page.n}</b><span>шаг из ${steps}</span></div>`;
  }
  return ex ? seqChips(ex, 16) : `<div class="step-badge" aria-hidden="true">${icon('book', 64)}</div>`;
}

function viewTheory(r) {
  const lessons = allLessons();
  const fromRoute = findLesson(r.a);
  let sel = fromRoute ? { lesson: fromRoute, step: Math.max(0, (Number(r.b) || 1) - 1) } : validTheory(last.theory) ?? { lesson: lessons[0], step: 0 };
  const render = (focus = null) => {
    const { lesson } = sel;
    const pages = theoryPages(lesson);
    sel.step = Math.min(Math.max(0, sel.step), pages.length - 1);
    const page = pages[sel.step];
    rememberPlace(href('theory',lesson.id,sel.step+1));
    saveLast({ theory: { lesson: lesson.id, step: sel.step } });
    history.replaceState(null, '', href('theory', lesson.id, sel.step + 1));
    setChrome(r, { lessonTitle: lessonTab(lesson) });
    const track = narrationFor(narration, 'lesson', lesson.id);
    const inModule = lesson.module.lessons;
    const el = screen('theory', `
      <h1 class="vh">Теория</h1>
      ${stripHtml({ name: 'group', label: 'Разделы курса', size: 'sm', selected: lesson.module.id,
        items: C.modules.map((m) => ({ id: m.id, label: moduleTab(m) })) })}
      ${inModule.length > 1 ? stripHtml({ name: 'lesson', label: 'Уроки', selected: lesson.id, controls: 'th-card',
        items: inModule.map((l) => ({ id: l.id, label: lessonTab({ ...l }) })) }) : ''}
      <article class="card th-card" id="th-card" role="tabpanel" aria-label="${esc(lessonTab(lesson))}">
        <div class="th-top"><h2>${esc(page.kind === 'summary' ? lessonTab(lesson) : `Шаг ${page.n}`)}</h2>${narrationHtml(track)}${lesson.exercises.length ? `<a class="btn th-play" href="${href('lesson', lesson.id, lesson.exercises[0].id)}">${icon('play', 18)}<span>Играть</span></a>` : ''}</div>
        <div class="th-visual">${theoryVisual(page, lesson, pages)}</div>
        <p class="th-text">${esc(page.text)}</p>
      </article>
      ${pagerHtml({ index: sel.step, total: pages.length, label: 'Шаги урока' })}
`);
    bindNarration(el, track);
    bindStrip(el, 'group', (id, kb) => {
      const m = C.modules.find((x) => x.id === id);
      sel = { lesson: findLesson(m.lessons[0].id), step: 0 };
      narrator.stop();
      render(kb ? ['group', id] : null);
    });
    bindStrip(el, 'lesson', (id, kb) => {
      sel = { lesson: findLesson(id), step: 0 };
      narrator.stop();
      render(kb ? ['lesson', id] : null);
    });
    bindPager(el, (d) => { sel.step += d; render(['pager', d]); });
    restoreFocus(el, focus);
  };
  render();
}

// ---------- удары ----------

function strokeTabs() {
  const count = new Map();
  C.strokes.forEach((s) => count.set(s.label, (count.get(s.label) ?? 0) + 1));
  const seen = new Map();
  return C.strokes.map((s) => {
    if (count.get(s.label) === 1) return { id: s.id, label: s.label };
    const n = (seen.get(s.label) ?? 0) + 1;
    seen.set(s.label, n);
    return { id: s.id, label: `${s.label} ${n}` };
  });
}

function viewStrokes(r) {
  const tabs = strokeTabs();
  const pick = (id) => tabs.findIndex((t) => t.id === id);
  let i = [pick(r.a), pick(last.stroke), 0].find((x) => x >= 0);
  const render = (focus = null) => {
    const s = C.strokes[i];
    rememberPlace(href('strokes',s.id));
    saveLast({ stroke: s.id });
    history.replaceState(null, '', href('strokes', s.id));
    setChrome(r, { lessonTitle: tabs[i].label });
    const described = s.status === 'confirmed' && !s.conflict;
    const hand = trustedHand(s);
    const text = described ? s.technique : '';
    const el = screen('strokes', `
      <h1 class="vh">Удары</h1>
      ${stripHtml({ name: 'stroke', label: 'Удары', selected: s.id, controls: 'st-card', items: tabs })}
      <article class="card st-card" id="st-card" role="tabpanel" aria-label="${esc(s.label)}">
        <div class="st-visual">${strokeFigure(s, { size: 140 })}</div>
        <div class="st-text">
          ${hand ? `<p class="st-hint">${esc(hand.short ?? hand.hint)}</p>` : ''}
          <div class="row"><button type="button" data-hear="${esc(s.id)}">${icon('sound', 22)}<span>Послушать</span></button>
            <span class="small muted" data-hear-st role="status"></span></div>
          ${text ? `<details class="st-more"><summary>Подробнее</summary><p class="small">${esc(text)}</p></details>` : ''}
        </div>
      </article>
      ${pagerHtml({ index: i, total: tabs.length, label: 'Удары по порядку' })}`);
    bindStrip(el, 'stroke', (id, kb) => { i = pick(id); render(kb ? ['stroke', id] : null); });
    bindPager(el, (d) => { i = Math.min(tabs.length - 1, Math.max(0, i + d)); render(['pager', d]); });
    el.querySelector('[data-hear]').addEventListener('click', (e) => hearStroke(e.currentTarget.dataset.hear, el.querySelector('[data-hear-st]')));
    restoreFocus(el, focus);
  };
  render();
}

// ---------- прогресс ----------

function viewProgress(r) {
  const lessons = practiceLessons();
  let i = Math.max(0, lessons.findIndex((l) => l.id === (r.a ?? last.progress)));
  const render = (focus = null) => {
    const lesson = lessons[i];
    saveLast({ progress: lesson.id });
    history.replaceState(null, '', href('progress', lesson.id));
    setChrome(r, { lessonTitle: lessonTab(lesson) });
    const totals = lessons.reduce((a, l) => {
      l.exercises.forEach((e) => { const p = exerciseProgress(progress, e.id); a.reps += p.reps; a.cycles += p.cycles; });
      if (progress.lessons[l.id]) a.done += 1;
      return a;
    }, { reps: 0, cycles: 0, done: 0 });
    const sm = lessonSummary(progress, lesson);
    const el = screen('progress', `
      <h1 class="vh">Прогресс</h1>
      <div class="totals">
        <div class="total"><b>${totals.reps}</b><span>повторений</span></div>
        <div class="total"><b>${totals.cycles}</b><span>полных циклов</span></div>
        <div class="total"><b>${totals.done}/${lessons.length}</b><span>уроков пройдено</span></div>
      </div>
      <article class="card pr-card" id="pr-card" aria-label="${esc(lessonTab(lesson))}">
        <h2>${esc(lessonTab(lesson))}${sm.done ? ' <span class="chip">пройден</span>' : ''}</h2>
        <ul class="pr-list">${lesson.exercises.map((e) => {
          const p = exerciseProgress(progress, e.id);
          return `<li><span class="pr-ex">${esc(e.title)}</span>
            <span class="pr-nums"><span><b>${p.reps}</b> повт.</span><span><b>${p.cycles}</b> цикл.</span><span>темп <b>${p.bestRate || '—'}</b></span></span></li>`;
        }).join('')}</ul>
        <label class="check"><input type="checkbox" data-done${sm.done ? ' checked' : ''}> Урок пройден (самооценка)</label>
      </article>
      ${pagerHtml({ index: i, total: lessons.length, label: 'Уроки по порядку' })}
      <div class="pr-foot"><p class="small muted">Самооценка. Данные — в этом браузере.</p>
        <button type="button" class="link-btn small" data-reset>Сбросить прогресс</button></div>`);
    bindPager(el, (d) => { i = Math.min(lessons.length - 1, Math.max(0, i + d)); render(['pager', d]); });
    el.querySelector('[data-done]').addEventListener('change', (e) => {
      saveProgress(setLessonDone(progress, lesson.id, e.target.checked));
      render();
      app.querySelector('[data-done]')?.focus();
    });
    el.querySelector('[data-reset]').addEventListener('click', () => {
      if (confirm('Удалить весь прогресс в этом браузере?')) { saveProgress(emptyProgress()); render(); }
    });
    restoreFocus(el, focus);
  };
  render();
}

// ---------- о приложении ----------

function viewAbout(r) {
  setChrome(r);
  const track = narrationFor(narration, 'about');
  const el = screen('about', `
    <article class="card about-card">
      <div class="th-top"><h1>О приложении</h1>${narrationHtml(track)}</div>
      <p>Ритмические мантры с подсказками и метрономом.</p>
      <ul class="about-list">
        <li>${icon('sound', 22)}<span>Тембры ударов синтезированы.</span></li>
        <li>${icon('play', 22)}<span>Ровный пульс для изучения слогов.</span></li>
        <li>${icon('chart', 22)}<span>Счётчик воспроизведения. Прогресс — самооценка.</span></li>
      </ul>
      <a class="btn support-link" href="#/support">Написать в техподдержку</a>
      <p class="small muted">По курсу Sadhu Priya das, scsmath. · Версия ${APP_VERSION}</p>
    </article>`);
  bindNarration(el, track);
}

// ---------- проверка звука ----------

// Короткая проверка на телефоне: щелчок, метроном, удары по одному, громкость
// и «Стоп». Сведения для бланка и проба с упражнением — в свёрнутом блоке.
// Микрофон и камера не используются.
const DIAG_VOLUME = 0.3;

function diagInfoText() {
  const a = player.audioInfo();
  const ms = (x) => (x === null || x === undefined ? 'браузер не сообщает' : `${(x * 1000).toFixed(1)} мс (сообщает браузер, не измерение)`);
  return [
    `Версия приложения: ${APP_VERSION}`,
    `Адрес: ${location.origin}`,
    `Браузер: ${navigator.userAgent}`,
    `Экран: ${window.innerWidth}×${window.innerHeight} CSS px, плотность ${window.devicePixelRatio}`,
    `Уменьшение движения: ${window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'включено' : 'выключено'}`,
    `Звук: ${a.state}${a.sampleRate ? `, ${a.sampleRate} Гц` : ''}`,
    `baseLatency: ${a.state === 'не создан' ? '—' : ms(a.baseLatency)}`,
    `outputLatency: ${a.state === 'не создан' ? '—' : ms(a.outputLatency)}`,
    `Громкость приложения: ${Math.round(player.volume * 100)}%`,
  ].join('\n');
}

function viewSound(r) {
  setChrome(r);
  player.setVolume(DIAG_VOLUME);
  const previewProfiles = soundMap();
  const auditoryLabel = (st) => {
    if (!C.strokes.some(other => other.id !== st.id && other.label === st.label)) return st.label;
    return `${st.label} · ${FAMILY_INFO[previewProfiles.get(st.id).family].label.toLowerCase()}`;
  };
  const exercises = allLessons().flatMap((l) => l.exercises.map((e) => ({ e, l })));
  const el = screen('sound', `
    <article class="card sound-card">
      <h1>Проверка звука</h1>
      <p class="small muted">Начните с умеренной громкости.</p>
      <div class="sound-main">
        <button type="button" data-d="click">Один щелчок</button>
        <label class="inline">Темп <select data-d="metro-rate" aria-label="Щелчков в минуту"><option>40</option><option selected>60</option><option>120</option><option>180</option></select></label>
        <button type="button" data-d="metro">Включить</button>
        <button type="button" class="primary" data-d="stop">■ Стоп</button>
      </div>
      <div class="sound-vol">
        <label>Громкость <input type="range" data-d="vol" min="0" max="100" value="${Math.round(DIAG_VOLUME * 100)}"></label>
        <span data-d="vol-n">${Math.round(DIAG_VOLUME * 100)}%</span>
        <span class="diag-flash" data-d="flash" aria-hidden="true"></span>
        <span class="small diag-state" data-d="state" role="status">остановлено</span>
      </div>
      <div class="strip strip-sm over-ok"><div class="strip-scroll" role="group" aria-label="Звуки ударов">${C.strokes.map((st) =>
        `<button type="button" class="tab" data-diag-stroke="${esc(st.id)}">${esc(auditoryLabel(st))}</button>`).join('')}</div></div>
      <details class="diag-more"><summary>Сведения о звуке</summary>
        <pre class="diag-info" data-d="info"></pre>
        <div class="row"><button type="button" data-d="copy">Скопировать</button> <span class="small muted" data-d="copy-st"></span></div>
        <p class="small muted">baseLatency и outputLatency сообщает браузер; это не измерение задержки динамика или Bluetooth.</p>
        <div class="row">
          <label class="inline">Упражнение <select data-d="ex">${exercises.map(({ e, l }) => `<option value="${esc(e.id)}"${e.id === 'pm1' ? ' selected' : ''}>${esc(lessonTab(l))} — ${esc(e.title)}</option>`).join('')}</select></label>
          <label class="inline">Темп <select data-d="ex-rate"><option>40</option><option selected>60</option><option>90</option><option>120</option><option>180</option></select></label>
          <button type="button" data-d="ex-play">С метрономом</button>
        </div>
        <div class="lane" data-d="lane"></div>
      </details>
    </article>`);
  const $ = (k) => el.querySelector(`[data-d="${k}"]`);
  const flash = $('flash');
  const info = () => { $('info').textContent = diagInfoText(); };
  info();
  const stateEl = $('state');
  const laneBox = $('lane');
  let flashTimer = 0;
  let probe = 0; // номер текущей пробы: события и окончание прежней не трогают экран
  const blink = () => {
    flash.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flash.classList.remove('on'), 90);
  };
  // Сбросить всё видимое от прежней пробы: ленту упражнения, вспышку, состояние.
  const clearProbe = (state) => {
    clearTimeout(flashTimer);
    flashTimer = 0;
    flash.classList.remove('on');
    laneBox.hidden = true;
    laneBox.innerHTML = '';
    stateEl.textContent = state;
  };
  clearProbe('остановлено');
  unmountView = () => { probe += 1; clearProbe('остановлено'); };
  const stopAll = () => {
    probe += 1;
    player.stop();
    clearProbe('остановлено');
    info();
  };
  const startPlan = async (title, plan, { metronomeId = 'off', playStrokes = false, showLane = null } = {}) => {
    narrator.stop();
    const my = ++probe;
    clearProbe(`включаю звук: ${title}…`);
    const onLane = showLane?.(plan);
    const status = await player.start({
      plan, strokeSounds: soundMap(), metronomeId, playStrokes,
      onStep: (ev) => { if (probe === my) { blink(); onLane?.(ev); } },
      onEnd: () => { if (probe === my) { clearProbe(`закончено: ${title}`); info(); } },
    });
    if (probe !== my) return; // за время ожидания нажали «Стоп» или выбрали другую пробу
    if (status === 'started') stateEl.textContent = `играет: ${title}`;
    else clearProbe(status === 'failed' ? startFailureText() : 'остановлено');
    info();
  };
  $('stop').addEventListener('click', stopAll);
  $('vol').addEventListener('input', (e) => {
    player.setVolume(Number(e.target.value) / 100);
    $('vol-n').textContent = `${e.target.value}%`;
    info();
  });
  const restTimeline = (bpm) => buildCycleTimeline(parsePattern('-', { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols }).beats, bpm);
  $('click').addEventListener('click', () => startPlan('один щелчок', createPlan(restTimeline(60), { maxCycles: 1 }), { metronomeId: 'every1' }));
  el.querySelectorAll('[data-diag-stroke]').forEach((b) => b.addEventListener('click', () => {
    // Тот же профиль, что в практике (soundMap), с коротким названием типа звука в строке состояния.
    const fam = previewProfiles.get(b.dataset.diagStroke)?.family;
    const rr = parsePattern(b.dataset.diagStroke, { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols });
    startPlan(`удар ${strokeMap.get(b.dataset.diagStroke).label}${fam ? ` · ${FAMILY_INFO[fam].label}` : ''}`, createPlan(buildCycleTimeline(rr.beats, 60), { maxCycles: 1 }), { playStrokes: true });
  }));
  $('metro').addEventListener('click', () => {
    const bpm = Number($('metro-rate').value);
    startPlan(`метроном ${bpm}`, createPlan(restTimeline(bpm)), { metronomeId: 'every1' });
  });
  $('ex-play').addEventListener('click', () => {
    const { e, l } = exercises.find((x) => x.e.id === $('ex').value);
    const parsed = parse(e);
    const tech = techniqueReliability(e, l, parsed.slots, strokeMap);
    const ctx = { strokeMap, lanes: C.config.lanes, notes: e.techniqueNotes ?? [], tech: new Map(tech.items.map((i) => [techKey(i), i])) };
    const cues = parsed.slots.map((slot, i) => practiceCue({ ...slot, slotIndex: i }, ctx));
    const rateV = Number($('ex-rate').value);
    const plan = createPlan(buildCycleTimeline(parsed.beats, beatBpmFromStrokeRate(rateV, e.subdivision)), { rate: rateV });
    startPlan(`${e.title} с метрономом, ${rateV}`, plan, {
      metronomeId: 'beat', playStrokes: true,
      showLane: (pl) => {
        laneBox.hidden = false;
        const dl = createLane(laneBox, (i) => cues[i]);
        dl.setMode('static');
        dl.setPlan(pl);
        dl.setPosition(-1);
        return (ev) => dl.setPosition(ev.seq);
      },
    });
  });
  $('copy').addEventListener('click', async () => {
    const text = diagInfoText();
    try {
      await navigator.clipboard.writeText(text);
      $('copy-st').textContent = 'скопировано';
    } catch {
      // Без безопасного соединения буфер обмена недоступен — выделяем текст для ручного копирования.
      const range = document.createRange();
      range.selectNodeContents($('info'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      $('copy-st').textContent = 'буфер недоступен — текст выделен, скопируйте вручную';
    }
  });
}

// ---------- для преподавателя (прежний адрес #/editor, вне главного меню) ----------

function viewEditor(r) {
  setChrome(r);
  const cur = { config: C.config, strokes: C.strokes, modules: C.modules };
  const el = screen('editor doc', `<h1>Для преподавателя</h1>
    <p class="muted">Здесь меняются названия ударов, описание техники, значки, обозначения «на два / на три» и сами упражнения — без правки кода.
    Правки проверяются и сохраняются только в этом браузере; чтобы перенести их в проект, скачайте JSON и замените файлы в папке content/.</p>
    ${overrideNotice ? `<p class="note small">${esc(overrideNotice)}</p>` : ''}
    <h2>Песочница записи</h2>
    <div class="row sandbox-fields">
      <label class="wide">Запись <input type="text" id="sb-pattern" value=">ke na | na >ko | na na | >ke na" spellcheck="false" autocapitalize="off"></label>
      <label>Поддолей в доле <input type="number" id="sb-sub" min="1" max="12" value="2"></label>
      <label>Группировка <input type="text" id="sb-group" size="8" value="3+3+2"></label>
    </div>
    <p class="small muted">Правила: слоги через пробел (id из словаря или псевдоним); «|» — граница доли; «-» — пауза; «&gt;» перед слогом — акцент;
    «a+b» — одновременно; «re=Те» — техника «re», подпись «Те».</p>
    <div id="sandbox" class="trainer sandbox"></div>
    <h2>Данные</h2>
    <div class="row" role="group" aria-label="Документ">
      <button type="button" data-doc="strokes" aria-pressed="true">Удары</button>
      <button type="button" data-doc="modules" aria-pressed="false">Уроки</button>
      <button type="button" data-doc="config" aria-pressed="false">Настройки записи</button>
    </div>
    <textarea id="json" spellcheck="false" aria-label="JSON"></textarea>
    <div class="row">
      <button type="button" id="check">Проверить</button>
      <button type="button" class="primary" id="save">Сохранить в этом браузере</button>
      <button type="button" id="download">Скачать JSON</button>
      <button type="button" id="restore">Вернуть исходные</button>
    </div>
    <div id="msg" class="small"></div>`);
  const q = (s) => el.querySelector(s);

  const sb = () => {
    const ex = {
      id: 'sandbox', title: 'Песочница', pattern: q('#sb-pattern').value,
      subdivision: Number(q('#sb-sub').value), status: 'teacher', rhythmStatus: 'teacher',
    };
    const g = q('#sb-group').value.split('+').map(Number).filter((n) => n > 0);
    const rr = parse(ex);
    if (g.length && g.reduce((a, b) => a + b, 0) === rr.slots.length) ex.grouping = g;
    endPractice();
    mountTrainer(q('#sandbox'), ex, { sandbox: true });
  };
  ['#sb-pattern', '#sb-sub', '#sb-group'].forEach((s) => q(s).addEventListener('input', sb));
  sb();

  const draft = structuredClone(cur);
  let doc = 'strokes';
  const ta = q('#json');
  const msg = q('#msg');
  const show = () => { ta.value = JSON.stringify(draft[doc], null, 2); };
  const pull = () => {
    try { draft[doc] = JSON.parse(ta.value); return true; } catch (e) {
      msg.innerHTML = `<p class="errors">JSON не разобран: ${esc(e.message)}</p>`; return false;
    }
  };
  show();
  el.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    if (!pull()) return;
    doc = b.dataset.doc;
    el.querySelectorAll('[data-doc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    show();
  }));
  const check = () => {
    if (!pull()) return null;
    const errs = validateContent(draft);
    msg.innerHTML = errs.length
      ? `<p class="errors">Ошибок: ${errs.length}\n${esc(errs.join('\n'))}</p>`
      : '<p class="ok">Ошибок нет.</p>';
    return errs;
  };
  q('#check').addEventListener('click', check);
  q('#save').addEventListener('click', () => {
    const errs = check();
    if (!errs || errs.length) return;
    if (!store.set(KEYS.overrides, draft)) { msg.innerHTML = '<p class="errors">Хранилище браузера недоступно — сохранить не удалось.</p>'; return; }
    applyOverrides();
    msg.innerHTML = '<p class="ok">Сохранено в этом браузере. Изменения уже действуют во всех разделах.</p>';
  });
  q('#download').addEventListener('click', () => {
    if (!pull()) return;
    const name = { strokes: 'strokes.json', modules: 'lessons.json', config: 'notation-config.json' }[doc];
    const body = doc === 'strokes' ? { version: base.strokes.version, strokes: draft.strokes }
      : doc === 'modules' ? { version: '0.1.0', defaults: C.defaults, modules: draft.modules } : draft.config;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  q('#restore').addEventListener('click', () => {
    if (!confirm('Удалить правки преподавателя в этом браузере и вернуть исходные данные?')) return;
    store.del(KEYS.overrides);
    applyOverrides();
    viewEditor(r);
  });
}

// ---------- маршруты ----------

// Уборка видимых хвостов страницы (таймеры вспышки и т. п.) при уходе с неё.
let unmountView = null;
let firstRoute = true;

function route() {
  endPractice();
  narrator.stop();
  narrationUi = null;
  unmountView?.();
  unmountView = null;
  player.setVolume(practiceVolume); // громкость диагностики не переносится на уроки
  const r = parseRoute(location.hash);
  if (r.page === 'lesson') viewTraining(r);
  else if (r.page === 'practice') viewPractice(r);
  else if (r.page === 'theory') viewTheory(r);
  else if (r.page === 'strokes') viewStrokes(r);
  else if (r.page === 'progress') viewProgress(r);
  else if (r.page === 'sound') viewSound(r);
  else if (r.page === 'about') viewAbout(r);
  else if (r.page === 'support') viewSupport(r);
  else if (r.page === 'editor') viewEditor(r);
  else viewHome();
  app.scrollTop = 0;
  window.scrollTo(0, 0);
  // После перехода фокус — в начало новой страницы (для клавиатуры и диктора).
  if (!firstRoute) app.focus({ preventScroll: true });
  firstRoute = false;
}

// Закрытие или перезагрузка вкладки во время практики — записать полные циклы.
window.addEventListener('pagehide', () => { endPractice(); narrator.stop(); unmountView?.(); });
// Вкладка скрыта (переключились на другую, погас экран): звук не останавливаем,
// но уже сыгранные полные циклы записываем сразу — вдруг вкладку закроют фоном.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') practice?.checkpoint();
});

loadContent().then(() => {
  window.addEventListener('hashchange', route);
  // Refresh the menu if another document (including /eight/) changed the bookmark.
  const refreshHome = () => { if (parseRoute(location.hash).page === 'home') viewHome(); };
  window.addEventListener('pageshow', e => { if(e.persisted) refreshHome(); });
  window.addEventListener('storage', e => { if(e.key === BOOKMARK || e.key === null) refreshHome(); });
  route();
}).catch((e) => {
  setChrome({ page: 'home' });
  app.innerHTML = `<section class="screen msg"><h1>Не удалось загрузить данные</h1><p class="errors">${esc(e.message)}</p>
    <p>Проверьте подключение к интернету и обновите страницу. Если ошибка повторяется, сообщите о ней автору приложения.</p></section>`;
});
