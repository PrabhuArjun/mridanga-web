// Приложение: загрузка контента, маршруты (#/…), страницы. Без сборки и
// внешних библиотек: ES-модули прямо в браузере.
import {
  parsePattern, buildCycleTimeline, countStrokes, tempoLadder, slotLabel, beatBpmFromStrokeRate,
} from './model/notation.js';
import { validateContent } from './model/content.js';
import {
  normalizeProgress, recordRun, markRep, toggleLadderStep, setLessonDone, lessonSummary,
  exerciseProgress, emptyProgress,
} from './model/progress.js';
import { Player } from './audio/engine.js?v=0.2.2';
import { createPlan, positionAtTime } from './audio/transport.js';
import { createLane } from './ui/lane.js';
import { createMotion } from './ui/motion.js';
import { handSvg } from './ui/hand.js';
import { eventCue, techKey } from './model/cue.js';
import { METRONOME_MODES } from './audio/scheduler.js';
import { renderStaff, glyphSvg } from './ui/staff.js';
import { followScrollLeft } from './ui/follow.js';
import { createPracticeRun } from './model/practice-run.js';
import {
  lessonReliability, techniqueReliability, lanesReliability, weakestStatus,
} from './model/reliability.js';

const APP_VERSION = '0.2.2';
const KEYS = { overrides: 'mridanga.overrides.v1', progress: 'mridanga.progress.v1', view: 'mridanga.view.v1' };
const app = document.getElementById('app');
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
const mediaAvailable = new Map();
// Идущая практика (одна на страницу): end() записывает полные циклы и
// останавливает звук, checkpoint() записывает их, не останавливая.
let practice = null;

function endPractice() {
  practice?.end();
  practice = null;
  player.stop();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = (t) => String(t).split(':').reduce((a, x) => a * 60 + Number(x), 0);

async function loadJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function loadContent() {
  const [config, strokesDoc, lessonsDoc, media] = await Promise.all([
    loadJson('content/notation-config.json'), loadJson('content/strokes.json'),
    loadJson('content/lessons.json'), loadJson('content/media.json'),
  ]);
  base = { config, strokes: strokesDoc.strokes, modules: lessonsDoc.modules, defaults: lessonsDoc.defaults, media };
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
  strokeMap = new Map(C.strokes.map((s) => [s.id, s]));
}

function saveProgress(p) {
  progress = p;
  store.set(KEYS.progress, p);
}

// ---------- общие элементы ----------

function chip(status) {
  const label = C.config.statuses?.[status] ?? status;
  return `<span class="chip st-${esc(status)}">${esc(label)}</span>`;
}

/** Статус одного слоя записи с подписью: «Слоги: подтверждено видео». */
function layerChip(layer, status) {
  if (!status) return '';
  const label = C.config.statuses?.[status] ?? status;
  return `<span class="chip st-${esc(status)}">${esc(layer)}: ${esc(label)}</span>`;
}

function feelChip(feelId) {
  const f = C.config.feels?.find((x) => x.id === feelId);
  if (!f) return '';
  const unsure = f.status && f.status !== 'confirmed' ? ` · ${C.config.statuses?.[f.status] ?? f.status}` : '';
  const basis = f.basis ? `\n${f.basis.text}: ${C.config.statuses?.[f.basis.status] ?? f.basis.status}` : '';
  return `<span class="chip feel" title="${esc(f.description + basis)}">${esc(f.label)}${esc(unsure)}</span>`;
}

/** Пояснение к обозначению счёта на странице урока: что сказано прямо, а что — толкование. */
function feelNote(feelId) {
  const f = C.config.feels?.find((x) => x.id === feelId);
  if (!f) return '';
  const src = f.source ? ` <span class="tc">${esc(f.source.video)} ${esc(f.source.t)}</span>` : '';
  const basis = f.basis
    ? `<br>${esc(f.basis.text)}: ${chip(f.basis.status)} <span class="muted">${esc(f.basis.note)}</span>` : '';
  return `<p class="small">«${esc(f.label)}»: ${esc(f.description)}${src} ${chip(f.status)}${basis}</p>`;
}

function reliabilityChips(lesson) {
  const r = lessonReliability(lesson);
  if (r.content) return layerChip('Содержание', r.content);
  return layerChip('Слоги', r.syllables) + layerChip('Ритм', r.rhythm);
}

function srcText(s) {
  if (!s.video) return esc(s.note ?? '');
  return `<span class="tc">${esc(s.video)} ${esc(s.t)}</span>${s.note ? ` — ${esc(s.note)}` : ''}`;
}

function allLessons() {
  return C.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m })));
}

function glyphIcon(stroke) {
  const parts = stroke.combination?.length ? stroke.combination.map((id) => strokeMap.get(id)) : [stroke];
  const inner = parts.map((s, i) => glyphSvg(s?.glyph, 26 + (parts.length > 1 ? (i ? 10 : -10) : 0), 26)).join('');
  return `<svg class="staff" viewBox="0 0 52 52" aria-hidden="true"><defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hatch-bg" width="5" height="5"/><line class="hatch-line" x1="0" y1="0" x2="0" y2="5"/></pattern></defs>${inner}</svg>`;
}

function laneLabel(id) {
  if (id === 'both') return 'Обе руки одновременно';
  return C.config.lanes.find((l) => l.id === id)?.label ?? id;
}

function strokeCard(s, { withSources = true } = {}) {
  return `<article class="card stroke-card">
    ${glyphIcon(s)}
    <div>
      <div class="label">${esc(s.label)} <span class="id">${esc(s.id)}</span></div>
      <div class="small muted">${esc(laneLabel(s.lane))}</div>
      <p class="small">${esc(s.technique)}</p>
      ${s.hand ? `<div class="hand-hint small">${handSvg(s.hand, { lane: s.lane === 'left' ? 'left' : 'right', tentative: s.hand.status !== 'confirmed', size: 32 })}
        <span>Подсказка: ${esc(s.hand.hint)}${s.hand.note ? ` — <span class="muted">${esc(s.hand.note)}</span>` : ''}${s.hand.short ? `<br><span class="muted">На ленте кратко: «${esc(s.hand.short)}»</span>` : ''}
        <span class="tc">${esc(s.hand.source.video)} ${esc(s.hand.source.t)}</span> ${layerChip('Подсказка кисти', s.hand.status)}</span></div>` : ''}
      ${s.variants ? `<p class="small muted">Варианты: ${esc(s.variants)}</p>` : ''}
      ${s.conflict ? `<p class="conflict">Расхождение: ${esc(s.conflict)}</p>` : ''}
      <div class="meta">${layerChip('Описание удара', s.status)}
        <button type="button" data-hear="${esc(s.id)}" title="Синтезированный звук, не запись мриданги">Послушать (синтез)</button>
      </div>
      ${withSources && s.sources?.length ? `<ul class="sources small">${s.sources.map((x) => `<li>${srcText(x)}</li>`).join('')}</ul>` : ''}
      ${withSources ? '<p class="small muted">Статус относится к месту, где удар объяснён (источники выше), а не к каждой мантре, где встречается слог.</p>' : ''}
    </div>
  </article>`;
}

function bindHearButtons(root) {
  root.querySelectorAll('[data-hear]').forEach((b) => b.addEventListener('click', () => {
    endPractice();
    const r = parsePattern(b.dataset.hear, { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols });
    player.start({
      plan: createPlan(buildCycleTimeline(r.beats, 60), { maxCycles: 1 }), strokeSounds: soundMap(), metronomeId: 'off',
      playStrokes: true,
    }).then((st) => showStartFailure(b, st));
  }));
}

/** Отказ браузера включить звук — видимая строка рядом с кнопкой, а не тишина. */
function showStartFailure(anchor, status) {
  const old = anchor.parentElement?.querySelector('.start-fail');
  old?.remove();
  if (status !== 'failed') return;
  const m = document.createElement('span');
  m.className = 'small warn start-fail';
  m.setAttribute('role', 'status');
  m.textContent = startFailureText();
  anchor.after(m);
}

function startFailureText() {
  return 'Браузер не включил звук. Нажмите ещё раз; на телефоне проверьте беззвучный режим.';
}

function soundMap() {
  // У составного удара («Так», «Дхин») — собственный звук из strokes.json.
  return new Map(C.strokes.map((s) => [s.id, s.sound]));
}

// ---------- страницы ----------

function viewCatalog() {
  const intro = `<h1>Уроки</h1>
    <p class="muted">Программа собрана по видеокурсу «Mridanga Lessons» (14 видео). Каждый вывод помечен уровнем уверенности.
    Слоги записаны кириллицей на слух и по титрам — это не утверждённая преподавателем терминология.</p>
    ${overrideNotice ? `<p class="warn small">${esc(overrideNotice)}</p>` : ''}`;
  const mods = C.modules.map((m) => `<section>
      <h2>${esc(m.title)}</h2>
      <div class="grid">${m.lessons.map((l) => {
        const sm = lessonSummary(progress, l);
        const prog = l.exercises.length
          ? `<span class="chip plain">отработано ${sm.practiced}/${sm.total}</span>` : '';
        return `<a class="card" href="#/lesson/${encodeURIComponent(l.id)}">
          <h3>${esc(l.title)}${sm.done ? ' ✓' : ''}</h3>
          <div class="small muted">${esc(l.summary)}</div>
          <div class="meta">${reliabilityChips(l)}${feelChip(l.feel)}${prog}</div>
        </a>`;
      }).join('')}</div></section>`).join('');
  app.innerHTML = intro + mods;
}

function viewLesson(lessonId, exId) {
  const lesson = allLessons().find((l) => l.id === lessonId);
  if (!lesson) {
    app.innerHTML = '<h1>Урок не найден</h1><p><a href="#/">К списку уроков</a></p>';
    return;
  }
  const ex = lesson.exercises.find((e) => e.id === exId) ?? lesson.exercises[0];
  const usedIds = new Set();
  const techStatuses = [];
  for (const e of lesson.exercises) {
    const r = parsePattern(e.pattern, { strokes: C.strokes, subdivision: e.subdivision, symbols: C.config.symbols });
    r.slots.forEach((s) => s.strokes.forEach((id) => usedIds.add(id)));
    techStatuses.push(techniqueReliability(e, lesson, r.slots, strokeMap).status);
  }
  const techChip = layerChip('Выбор удара', weakestStatus(techStatuses));
  const sm = lessonSummary(progress, lesson);
  const video = lesson.video
    ? `<section class="video-box" data-video="${esc(lesson.video.id)}">
        <h2>Эталон из видео</h2>
        <p class="small muted">Фрагмент <span class="tc">${esc(lesson.video.id)} ${esc(lesson.video.start)}–${esc(lesson.video.end)}</span>.</p>
        <div class="video-slot"><p class="small muted">Проверяю, подключено ли видео…</p></div>
      </section>` : '';

  app.innerHTML = `
    <p class="small"><a href="#/">← Уроки</a> · ${esc(lesson.module.title)}</p>
    <div class="lesson-head">
      <h1>${esc(lesson.title)}</h1>
      <div class="meta row">${reliabilityChips(lesson)}${techChip}${feelChip(lesson.feel)}</div>
      <p>${esc(lesson.summary)}</p>
      ${feelNote(lesson.feel)}
    </div>
    ${lesson.steps?.length ? `<h2>Как заниматься</h2><ol>${lesson.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${ex ? `<h2>Упражнение</h2>
      ${lesson.exercises.length > 1 ? `<div class="tabs" role="tablist">${lesson.exercises.map((e) =>
        `<a role="tab" class="chip plain" aria-selected="${e.id === ex.id}" href="#/lesson/${encodeURIComponent(lesson.id)}/${encodeURIComponent(e.id)}"${e.id === ex.id ? ' style="color:var(--accent)"' : ''}>${esc(e.title)}</a>`).join('')}</div>` : ''}
      <div id="exercise"></div>` : '<p class="muted">В этом уроке нет ритмических упражнений.</p>'}
    ${video}
    ${usedIds.size ? `<h2>Удары урока</h2><div class="grid">${[...usedIds].map((id) => strokeCard(strokeMap.get(id), { withSources: false })).join('')}</div>` : ''}
    <h2>Источники и уверенность</h2>
    <ul class="sources small">${lesson.sources.map((s) => `<li>${s.video ? `<button type="button" class="tc-link" data-seek="${esc(s.video)}|${esc(s.t)}">${esc(s.video)} ${esc(s.t)}</button>${s.note ? ` — ${esc(s.note)}` : ''}` : srcText(s)}</li>`).join('')}</ul>
    <h2>Отметка</h2>
    <label><input type="checkbox" id="lesson-done" ${sm.done ? 'checked' : ''}> Урок пройден (самооценка)</label>
  `;
  if (ex) mountExercise(document.getElementById('exercise'), ex, { lesson });
  app.querySelector('#lesson-done').addEventListener('change', (e) => saveProgress(setLessonDone(progress, lesson.id, e.target.checked)));
  bindHearButtons(app);
  if (lesson.video) mountVideo(app.querySelector('.video-box'), lesson.video);
}

async function hasMedia(_id) {
  // Course videos are not included in this public release.
  return false;
}

async function mountVideo(box, v) {
  const slot = box.querySelector('.video-slot');
  const ok = await hasMedia(v.id);
  if (!ok) {
    slot.innerHTML = `<p class="small warn">Видео курса не размещены на этом сайте. Таймкод источника:
      <span class="tc">${esc(v.id)} ${esc(v.start)}–${esc(v.end)}</span>. Сверяйте технику с преподавателем.</p>`;
    return;
  }
  slot.innerHTML = `<video controls preload="metadata" src="media/${encodeURIComponent(v.id)}.mp4#t=${sec(v.start)},${sec(v.end)}"></video>`;
  const video = slot.querySelector('video');
  app.querySelectorAll('[data-seek]').forEach((b) => {
    const [vid, t] = b.dataset.seek.split('|');
    if (vid !== v.id) { b.disabled = true; b.title = 'Это другое видео курса'; return; }
    b.addEventListener('click', () => { video.currentTime = sec(t); video.play(); video.scrollIntoView({ block: 'nearest' }); });
  });
}

/** Что в записи подтверждено: слоги, ритм, выбор удара и руки — отдельными строками. */
function reliabilityBox(ex, lesson, parsed, lanes) {
  const tech = techniqueReliability(ex, lesson, parsed.slots, strokeMap);
  const hands = lanesReliability(lanes);
  const rhythmText = ex.rhythmNote
    ?? (ex.rhythmStatus === 'confirmed' ? ''
      : 'В видео длительности слогов не названы; показаны равными, раскладка по долям — допущение прототипа.');
  const why = {
    lesson: (i) => `объяснён в видео этого урока${i.source ? `: <span class="tc">${esc(i.source.video)} ${esc(i.source.t)}</span>` : ''}`,
    transferred: (i) => `техника взята из <span class="tc">${esc(i.source?.video ?? '?')} ${esc(i.source?.t ?? '')}</span>; в видео этого урока отдельно не объяснена — допущение`,
    card: () => 'описание самого удара не подтверждено (см. «Удары»)',
    conflict: () => 'в видео есть расхождение по этому удару (см. «Удары»)',
    alias: (i) => (i.note
      ? `слог «${esc(i.label)}» играется как «${esc(i.technique)}»: ${esc(i.note)} <span class="tc">${esc(i.source.video)} ${esc(i.source.t)}</span>`
      : `слог «${esc(i.label)}» играется как «${esc(i.technique)}» — толкование прототипа`),
  };
  const items = tech.items.map((i) => `<li>«${esc(i.label)}» <span class="id">${esc(i.id)}</span> ${chip(i.status)} — ${why[i.reason](i)}</li>`).join('');
  const notes = tech.notes.map((n) => `<li>${esc(n.text)} ${chip(n.status)}${n.video ? ` <span class="tc">${esc(n.video)} ${esc(n.t)}</span>` : ''}</li>`).join('');
  return `<dl class="reliab" aria-label="Что в этой записи подтверждено">
    <dt>Слоги</dt><dd>${chip(ex.status)}</dd>
    <dt>Длительности и доли</dt><dd>${chip(ex.rhythmStatus)}${rhythmText ? ` <span class="small">${esc(rhythmText)}</span>` : ''}</dd>
    <dt>Выбор удара для слога</dt><dd>${chip(tech.status)}
      <details><summary class="small">по слогам</summary>
        <p class="small muted">Слог не закреплён за аппликатурой (V02 01:02), поэтому удар для слога выбран по объяснению в уроке.</p>
        <ul class="sources small">${items}${notes}</ul></details></dd>
    <dt>Руки и мембраны (линии записи)</dt><dd>${chip(hands.status)}
      <span class="small">${esc(hands.lanes.map((l) => l.note).filter(Boolean)[0] ?? '')}</span></dd>
  </dl>`;
}

/** Вид практики: лента, без движения или полная запись. Системное «уменьшить движение» → без движения. */
function preferredView() {
  const saved = store.get(KEYS.view);
  if (['moving', 'static', 'staff'].includes(saved)) return saved;
  return reducedMotion() ? 'static' : 'moving';
}
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Панель упражнения: лента, запись, темп, метроном, счётчики, повторения. */
function mountExercise(root, ex, { sandbox = false, lesson = null } = {}) {
  const parsed = parsePattern(ex.pattern, { strokes: C.strokes, subdivision: ex.subdivision, symbols: C.config.symbols });
  if (parsed.errors.length) {
    root.innerHTML = `<p class="errors">${esc(parsed.errors.join('\n'))}</p>`;
    return;
  }
  const usedLanes = new Set(parsed.slots.flatMap((s) => s.strokes.flatMap((id) => {
    const st = strokeMap.get(id);
    return st?.combination ? st.combination.map((c) => strokeMap.get(c)?.lane) : [st?.lane];
  })));
  const lanes = C.config.lanes.filter((l) => l.id !== 'unknown' || usedLanes.has('unknown'));
  const defaults = C.defaults ?? { slowRate: 60, fastFactor: 2, ladder: { from: 30, to: 90, step: 10 } };
  const slow = ex.tempo?.slow ?? defaults.slowRate;
  const fast = Math.round(slow * (defaults.fastFactor ?? 2));
  const ladderRates = tempoLadder(defaults.ladder.from, defaults.ladder.to, defaults.ladder.step);
  const prog = () => exerciseProgress(progress, ex.id);
  const perCycle = countStrokes(parsed.slots);
  const laneNote = (l) => (l.status && l.status !== 'confirmed' ? ` (${C.config.statuses?.[l.status] ?? l.status})` : '');
  // Подсказка для каждой поддоли рисунка — по удару события, а не по слогу.
  const tech = techniqueReliability(ex, lesson, parsed.slots, strokeMap);
  const cueCtx = {
    strokeMap, lanes: C.config.lanes, notes: ex.techniqueNotes ?? [],
    tech: new Map(tech.items.map((i) => [techKey(i), i])),
  };
  const cues = parsed.slots.map((slot, i) => eventCue({ ...slot, slotIndex: i }, cueCtx));
  const viewName = `view-${ex.id}-${sandbox ? 'sb' : 'ex'}`;

  root.innerHTML = `
    ${sandbox ? `<div class="meta row small">${layerChip('Слоги', ex.status)} ${layerChip('Ритм', ex.rhythmStatus)}</div>`
      : reliabilityBox(ex, lesson, parsed, lanes)}
    <div class="view-switch" role="radiogroup" aria-label="Вид упражнения">
      <label><input type="radio" name="${viewName}" value="moving"> Лента</label>
      <label><input type="radio" name="${viewName}" value="static"> Без движения</label>
      <label><input type="radio" name="${viewName}" value="staff"> Полная запись</label>
    </div>
    <div class="practice-sticky">
      <div class="lane" id="lane" aria-label="Лента ударов: текущий и следующие по записи"></div>
      <div class="row play-row">
        <button type="button" class="primary" id="play">▶ Играть</button>
        <div class="now-syl" id="now" aria-hidden="true">—</div>
        <div class="counters" aria-live="polite">
          <div class="counter">Удары<b id="c-strokes">0</b></div>
          <div class="counter">Циклы<b id="c-cycles">0</b></div>
        </div>
      </div>
      <p class="small tempo-msg" id="tempo-msg" aria-live="polite"></p>
    </div>
    <p class="small muted lane-note">Лента показывает <b>запись</b> упражнения по времени звука, а не вашу игру: приложение не слышит, что и какой рукой играете вы.
      Пальцы показаны только там, где они названы в видео; число в ладони — сколько пальцев, если какие именно не названо.
      «≈ предп.» — предположение (в том числе «П · малая≈»: какая рука на какой мембране — вывод из речи), «? проверить» — нужна проверка преподавателем, «? уточняется» — приём в видео не объяснён. Звук — условный синтез.</p>
    <div class="staff-block">
      <div class="staff-wrap">${renderStaff({ beats: parsed.beats, strokeMap, lanes, grouping: ex.grouping, title: `Запись: ${ex.title}` })}</div>
      <div class="staff-legend">${lanes.map((l, i) => `<span>Линия ${i + 1}: ${esc(l.label)}${esc(laneNote(l))}</span>`).join('')}
        <span>${parsed.beats.length} дол. × ${ex.subdivision} поддол. · ${perCycle} уд. в цикле</span></div>
    </div>
    <div class="controls">
      <div class="row tempo">
        <label for="rate">Темп</label>
        <input type="range" id="rate" min="20" max="240" step="1" value="${slow}">
        <input type="number" id="rate-n" min="20" max="240" value="${slow}" aria-label="Темп, ударов в минуту"> <span class="small muted">ударов в минуту</span>
      </div>
      <div class="row">
        <button type="button" data-rate="${slow}">Медленно (${slow})</button>
        <button type="button" data-rate="${fast}">Быстро ×2 (${fast})</button>
        <label>Метроном <select id="metro">${METRONOME_MODES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select></label>
        <label>Повторять <select id="cycles">
          <option value="1">1 цикл</option><option value="2">2 цикла</option><option value="4" selected>4 цикла</option>
          <option value="8">8 циклов</option><option value="Infinity">без остановки</option></select></label>
        <label title="Синтезированный звук ударов, не запись мриданги"><input type="checkbox" id="synth" checked> Эталонный звук (синтез)</label>
      </div>
      <p class="small muted">Темп во время игры меняется с начала следующего цикла; полные циклы прежнего темпа записываются с прежним темпом.</p>
      ${sandbox ? '' : `<p class="small muted">В прогресс записываются только полные циклы — и при «Стоп», и при уходе со страницы.</p>
      <div class="row">
        <button type="button" id="rep">Повторение выполнено</button>
        <span class="small muted" id="rep-info"></span>
      </div>
      <details${ex.ladder ? ' open' : ''}>
        <summary>Лестница темпа: от ${defaults.ladder.from} до ${defaults.ladder.to} через ${defaults.ladder.step}</summary>
        <p class="small muted">Нажмите на число, чтобы поставить темп; галочка — ступень пройдена (самооценка).</p>
        <div class="ladder">${ladderRates.map((r) => `<label><input type="checkbox" data-step="${r}"> <button type="button" class="tc-link" data-rate="${r}">${r}</button></label>`).join('')}</div>
      </details>`}
    </div>`;

  const $ = (s) => root.querySelector(s);
  const rate = $('#rate');
  const rateN = $('#rate-n');
  const metro = $('#metro');
  const cyclesSel = $('#cycles');
  metro.value = ex.ladder ? 'every1' : 'beat';
  const tempoMsg = $('#tempo-msg');

  // ----- лента -----
  const lane = createLane($('#lane'), (slotIndex) => cues[slotIndex]);
  const timelineAt = (r) => buildCycleTimeline(parsed.beats, beatBpmFromStrokeRate(r, ex.subdivision));
  // До старта лента показывает первые удары из того же плана, по которому пойдёт звук.
  const previewPlan = () => createPlan(timelineAt(Number(rate.value)), { maxCycles: Number(cyclesSel.value), rate: Number(rate.value) });
  lane.setPlan(previewPlan());
  lane.setPosition(-1);
  let view = preferredView();
  let run = null;
  // Плавное движение ленты между событиями — по часам звука (player.now()),
  // а не по своему таймеру. При «уменьшить движение» лента только перескакивает
  // на каждом событии (onStep), без плавного хода.
  const motion = createMotion({
    wanted: () => Boolean(run) && player.playing && view === 'moving' && !reducedMotion(),
    frame: () => {
      const t = player.now();
      if (t !== null && player.plan) lane.setPosition(positionAtTime(player.plan, t));
    },
  });
  const applyView = (v) => {
    view = v;
    root.querySelectorAll(`input[name="${viewName}"]`).forEach((r) => { r.checked = r.value === v; });
    $('#lane').hidden = v === 'staff';
    $('.staff-block').hidden = v !== 'staff';
    if (v !== 'staff') lane.setMode(v);
    motion.sync(); // возврат к «Ленте» во время игры возобновляет ход
  };
  applyView(view);
  root.querySelectorAll(`input[name="${viewName}"]`).forEach((r) => r.addEventListener('change', () => {
    store.set(KEYS.view, r.value);
    applyView(r.value);
  }));
  const onResize = () => {
    if (!root.isConnected) { window.removeEventListener('resize', onResize); return; }
    if (view === 'moving') lane.relayout();
  };
  window.addEventListener('resize', onResize);

  const play = $('#play');
  const wrap = $('.staff-wrap');

  const setRate = (v) => {
    const n = Math.min(240, Math.max(20, Math.round(Number(v) || slow)));
    rate.value = n; rateN.value = n;
    return n;
  };
  // Применить темп: до старта — к плану предпросмотра, во время игры — с ближайшей
  // незапланированной границы цикла (тот же план, по которому звучит звук).
  const applyTempo = (v) => {
    const n = setRate(v);
    if (!run) {
      lane.setPlan(previewPlan());
      tempoMsg.textContent = '';
      return;
    }
    const r = player.retime(timelineAt(n), n);
    if (r) {
      lane.setPlan(player.plan);
      tempoMsg.textContent = `Темп ${n} — с начала цикла ${r.cycle + 1}.`;
    } else {
      tempoMsg.textContent = `До конца прогона новой границы цикла нет: темп ${n} будет при следующем запуске.`;
    }
  };
  rate.addEventListener('input', () => setRate(rate.value));
  rate.addEventListener('change', () => applyTempo(rate.value));
  rateN.addEventListener('change', () => applyTempo(rateN.value));
  root.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => applyTempo(b.dataset.rate)));
  cyclesSel.addEventListener('change', () => { if (!run) lane.setPlan(previewPlan()); });

  const refreshInfo = () => {
    if (sandbox) return;
    const p = prog();
    $('#rep-info').textContent = `Отмечено повторений: ${p.reps} · прозвучало полных циклов: ${p.cycles} · самый быстрый темп с полным циклом: ${p.bestRate || '—'}`;
    root.querySelectorAll('[data-step]').forEach((c) => { c.checked = Boolean(p.ladder[c.dataset.step]); });
  };
  refreshInfo();
  if (!sandbox) {
    $('#rep').addEventListener('click', () => { saveProgress(markRep(progress, ex.id, new Date().toISOString())); refreshInfo(); });
    root.querySelectorAll('[data-step]').forEach((c) => c.addEventListener('change', () => {
      saveProgress(toggleLadderStep(progress, ex.id, Number(c.dataset.step)));
    }));
  }

  const highlight = (i) => {
    root.querySelectorAll('.slot-hl.cur').forEach((r) => r.classList.remove('cur'));
    if (i < 0) return;
    const cell = root.querySelector(`.slot-hl[data-slot="${i}"]`);
    if (!cell) return;
    cell.classList.add('cur');
    // Прокручиваем только рамку записи, не страницу.
    const left = Number(cell.getAttribute('x'));
    const next = followScrollLeft(wrap, left, left + Number(cell.getAttribute('width')));
    if (next !== null) wrap.scrollLeft = next;
  };
  // Записать ещё не записанные полные циклы. Частичный цикл не засчитывается,
  // повторный вызов ничего не добавляет (см. model/practice-run.js).
  const commit = (close) => {
    const r = run?.take({ close });
    if (r && !sandbox) {
      saveProgress(recordRun(progress, ex.id, { ...r, at: new Date().toISOString() }));
      refreshInfo();
    }
  };
  const finish = () => {
    commit(true);
    run = null;
    motion.sync();
    if (practice?.root === root) practice = null;
    play.textContent = '▶ Играть';
    highlight(-1);
    $('#now').textContent = '—';
    // Лента возвращается к началу: первые удары следующего запуска.
    lane.setPlan(previewPlan());
    lane.setPosition(-1);
  };
  play.addEventListener('click', async () => {
    if (run) {
      player.stop();
      finish();
      return;
    }
    endPractice();
    const strokesPerMin = Number(rate.value);
    const maxCycles = Number(cyclesSel.value);
    const plan = createPlan(timelineAt(strokesPerMin), { maxCycles, rate: strokesPerMin });
    run = createPracticeRun({
      slotsPerCycle: parsed.slots.length, strokesPerCycle: perCycle, rate: strokesPerMin, maxCycles,
    });
    practice = { root, end: finish, checkpoint: () => commit(false) };
    $('#c-strokes').textContent = '0';
    $('#c-cycles').textContent = '0';
    tempoMsg.textContent = '';
    wrap.scrollLeft = 0;
    play.textContent = '■ Стоп';
    lane.setPlan(plan);
    lane.setPosition(-1);
    const thisRun = run;
    $('#now').textContent = 'включаю звук…';
    const status = await player.start({
      plan, strokeSounds: soundMap(), metronomeId: metro.value, playStrokes: $('#synth').checked,
      onStep: (ev) => {
        if (run !== thisRun) return;
        // Первое событие нового темпа: циклы прежнего темпа записываются с прежним темпом.
        if (ev.rate !== run.rate) {
          commit(false);
          run.setRate(ev.rate);
        }
        run.step(ev);
        highlight(ev.slotIndex);
        lane.setPosition(ev.seq);
        $('#now').textContent = slotLabel(ev, strokeMap);
        $('#c-strokes').textContent = String(run.heard.strokes);
        $('#c-cycles').textContent = String(run.heard.cycles);
      },
      onEnd: () => { if (run === thisRun) finish(); },
    });
    if (run !== thisRun) return; // за время ожидания нажали «Стоп» или ушли со страницы
    if (status !== 'started') {
      // Браузер отказал (или запуск отменён в обход этой кнопки): интерфейс — в исходное.
      finish();
      if (status === 'failed') tempoMsg.textContent = startFailureText();
      return;
    }
    if ($('#now').textContent === 'включаю звук…') $('#now').textContent = '—';
    motion.sync();
  });
}

function viewStrokes() {
  app.innerHTML = `<h1>Удары</h1>
    <p class="muted">Один и тот же слог в курсе может играться по-разному: преподаватель прямо говорит, что слог не закреплён за аппликатурой (V02 01:02).
    Поэтому карточка — это удар (техника), а слог — его подпись. Звук кнопки «Послушать» синтезирован и только условно похож на мридангу.</p>
    <div class="grid">${C.strokes.map((s) => strokeCard(s)).join('')}</div>`;
  bindHearButtons(app);
}

function viewProgress() {
  const rows = allLessons().filter((l) => l.exercises.length).map((l) => l.exercises.map((e, i) => {
    const p = exerciseProgress(progress, e.id);
    return `<tr>${i === 0 ? `<td rowspan="${l.exercises.length}"><a href="#/lesson/${encodeURIComponent(l.id)}">${esc(l.title)}</a>${progress.lessons[l.id] ? ' ✓' : ''}</td>` : ''}
      <td>${esc(e.title)}</td><td>${p.reps}</td><td>${p.cycles}</td><td>${p.bestRate || '—'}</td>
      <td>${Object.keys(p.ladder).sort((a, b) => a - b).join(', ') || '—'}</td>
      <td class="small">${p.last ? esc(new Date(p.last).toLocaleString('ru-RU')) : '—'}</td></tr>`;
  }).join('')).join('');
  app.innerHTML = `<h1>Прогресс</h1>
    <p class="muted">Это самооценка: приложение не слушает вашу игру. «Повторения» — ваши отметки, «циклы» — сколько полных циклов прозвучало с метрономом/эталоном.
    Темп — самый быстрый, на котором приложение проиграло полный цикл, а не проверенный темп вашей игры.
    Данные хранятся только в этом браузере.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Урок</th><th>Упражнение</th><th>Повторений</th><th>Циклов</th><th>Самый быстрый темп с полным циклом</th><th>Ступени лестницы</th><th>Последнее занятие</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p><button type="button" id="reset">Сбросить прогресс</button></p>`;
  app.querySelector('#reset').addEventListener('click', () => {
    if (confirm('Удалить весь прогресс в этом браузере?')) { saveProgress(emptyProgress()); viewProgress(); }
  });
}

function viewEditor() {
  const cur = { config: C.config, strokes: C.strokes, modules: C.modules };
  app.innerHTML = `<h1>Для преподавателя</h1>
    <p class="muted">Здесь меняются названия ударов, описание техники, значки, обозначения «на два / на три» и сами упражнения — без правки кода.
    Правки проверяются и сохраняются только в этом браузере; чтобы перенести их в проект, скачайте JSON и замените файлы в папке content/.</p>
    ${overrideNotice ? `<p class="warn small">${esc(overrideNotice)}</p>` : ''}
    <h2>Песочница записи</h2>
    <div class="row sandbox-fields">
      <label class="wide">Запись <input type="text" id="sb-pattern" value=">ke na | na >ko | na na | >ke na" spellcheck="false" autocapitalize="off"></label>
      <label>Поддолей в доле <input type="number" id="sb-sub" min="1" max="12" value="2"></label>
      <label>Группировка <input type="text" id="sb-group" size="8" value="3+3+2"></label>
    </div>
    <p class="small muted">Правила: слоги через пробел (id из словаря или псевдоним); «|» — граница доли; «-» — пауза; «&gt;» перед слогом — акцент;
    «a+b» — одновременно; «re=Те» — техника «re», подпись «Те».</p>
    <div id="sandbox"></div>
    <h2>Данные</h2>
    <div class="row" role="tablist">
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
    <div id="msg" class="small"></div>`;

  const sb = () => {
    const ex = {
      id: 'sandbox', title: 'Песочница', pattern: app.querySelector('#sb-pattern').value,
      subdivision: Number(app.querySelector('#sb-sub').value), status: 'teacher', rhythmStatus: 'teacher',
    };
    const g = app.querySelector('#sb-group').value.split('+').map(Number).filter((n) => n > 0);
    const r = parsePattern(ex.pattern, { strokes: C.strokes, subdivision: ex.subdivision, symbols: C.config.symbols });
    if (g.length && g.reduce((a, b) => a + b, 0) === r.slots.length) ex.grouping = g;
    endPractice();
    mountExercise(app.querySelector('#sandbox'), ex, { sandbox: true });
  };
  ['#sb-pattern', '#sb-sub', '#sb-group'].forEach((s) => app.querySelector(s).addEventListener('input', sb));
  sb();

  const draft = structuredClone(cur);
  let doc = 'strokes';
  const ta = app.querySelector('#json');
  const msg = app.querySelector('#msg');
  const show = () => { ta.value = JSON.stringify(draft[doc], null, 2); };
  const pull = () => {
    try { draft[doc] = JSON.parse(ta.value); return true; } catch (e) {
      msg.innerHTML = `<p class="errors">JSON не разобран: ${esc(e.message)}</p>`; return false;
    }
  };
  show();
  app.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => {
    if (!pull()) return;
    doc = b.dataset.doc;
    app.querySelectorAll('[data-doc]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
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
  app.querySelector('#check').addEventListener('click', check);
  app.querySelector('#save').addEventListener('click', () => {
    const errs = check();
    if (!errs || errs.length) return;
    if (!store.set(KEYS.overrides, draft)) { msg.innerHTML = '<p class="errors">Хранилище браузера недоступно — сохранить не удалось.</p>'; return; }
    applyOverrides();
    msg.innerHTML = '<p class="ok">Сохранено в этом браузере. Изменения уже действуют во всех разделах.</p>';
  });
  app.querySelector('#download').addEventListener('click', () => {
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
  app.querySelector('#restore').addEventListener('click', () => {
    if (!confirm('Удалить правки преподавателя в этом браузере и вернуть исходные данные?')) return;
    store.del(KEYS.overrides);
    applyOverrides();
    viewEditor();
  });
}

function viewAbout() {
  const legend = Object.entries(C.config.statuses).map(([k]) => `<li>${chip(k)}</li>`).join('');
  app.innerHTML = `<h1>О прототипе</h1>
    <p>«Мриданга» — <b>учебный прототип</b> для знакомства и пробных занятий. Содержание ещё не проверено преподавателем.</p>
    <h2>Уровни уверенности</h2><ul class="sources">${legend}</ul>
    <p class="small">Уверенность указывается <b>по слоям</b>: слоги, длительности и доли, выбор удара для слога, руки и мембраны.
    «Подтверждено видео» у слогов не означает, что подтверждены ритм или техника — это видно в блоке над записью каждого упражнения.</p>
    <h2>Чего здесь нет</h2>
    <ul>
      <li><b>Распознавания игры ученика нет.</b> Приложение не слушает микрофон и не смотрит в камеру. Оценка точности и техники вашей игры пока не реализована.</li>
      <li>Звук «эталона» синтезирован и лишь условно похож на мридангу. Настоящий эталон — фрагмент видео преподавателя.</li>
      <li>Караталы в программу не включены.</li>
    </ul>
    <h2>Источник</h2>
    <p class="small">Видеокурс «Mridanga Lessons» (заставка «scsmath presents», ведущий — Sadhu Priya das, по титрам). Видео на этом сайте не размещены. Обозначения источников и таймкоды сохранены для сверки с преподавателем.</p>`;
}

// Диагностика звука для проверки на телефонах: пробный щелчок, звуки ударов по
// одному, метроном, метроном вместе с упражнением и лентой, безопасная громкость,
// мгновенный стоп и сведения для бланка. Микрофон и камера не используются.
const DIAG_VOLUME = 0.3;
const PLAYER_VOLUME = 0.8;

function diagInfoText() {
  const a = player.audioInfo();
  const ms = (x) => (x === null || x === undefined ? 'браузер не сообщает' : `${(x * 1000).toFixed(1)} мс (сообщает браузер, не измерение)`);
  return [
    `Версия приложения: ${APP_VERSION}`,
    `Адрес: ${location.origin}`,
    `Браузер: ${navigator.userAgent}`,
    `Экран: ${window.innerWidth}×${window.innerHeight} CSS px, плотность ${window.devicePixelRatio}`,
    `Уменьшение движения: ${reducedMotion() ? 'включено' : 'выключено'}`,
    `Звук: ${a.state}${a.sampleRate ? `, ${a.sampleRate} Гц` : ''}`,
    `baseLatency: ${a.state === 'не создан' ? '—' : ms(a.baseLatency)}`,
    `outputLatency: ${a.state === 'не создан' ? '—' : ms(a.outputLatency)}`,
    `Громкость приложения: ${Math.round(player.volume * 100)}%`,
  ].join('\n');
}

function viewSound() {
  player.setVolume(DIAG_VOLUME);
  const exercises = allLessons().flatMap((l) => l.exercises.map((e) => ({ e, l })));
  app.innerHTML = `<h1>Проверка звука</h1>
    <p>Экран для проверки на телефоне: слышно ли звук, не перекрывает ли метроном удары и совпадает ли подсказка со звуком.
    Начните с тихой громкости; громкость устройства держите на середине.</p>
    <p class="small warn">Звук — синтезированное приближение, не запись мриданги. Микрофон и камера не используются, ничего никуда не отправляется.</p>
    <div class="diag-grid">
      <div class="row diag-bar" role="region" aria-label="Стоп и громкость">
        <button type="button" class="primary diag-stop" id="d-stop">■ Стоп</button>
        <label>Громкость <input type="range" id="d-vol" min="0" max="100" value="${Math.round(DIAG_VOLUME * 100)}"> <span id="d-vol-n">${Math.round(DIAG_VOLUME * 100)}%</span></label>
        <div class="diag-flash" id="d-flash" aria-hidden="true">●</div>
        <span class="small diag-state" id="d-state" role="status">остановлено</span>
      </div>
      <p class="small muted">Панель «Стоп» и громкость всегда внизу экрана. Громкость здесь — только для этого экрана; на страницах уроков остаётся ${Math.round(PLAYER_VOLUME * 100)}%. Кружок вспыхивает в момент, на который запланирован звук.</p>
      <h2>1. Пробный щелчок</h2>
      <div class="row"><button type="button" id="d-click">Один щелчок</button></div>
      <h2>2. Звуки ударов по одному</h2>
      <div class="diag-sounds">${C.strokes.map((st) => `<button type="button" data-diag-stroke="${esc(st.id)}" title="${esc(st.id)}">${esc(st.label)} <span class="small muted">${esc(st.id)}</span></button>`).join('')}</div>
      <h2>3. Метроном</h2>
      <div class="row">
        <label>Темп <select id="d-metro-rate"><option>40</option><option selected>60</option><option>120</option><option>180</option></select> щелчков/мин</label>
        <button type="button" id="d-metro">Метроном без остановки</button>
      </div>
      <h2>4. Метроном вместе с упражнением</h2>
      <div class="row">
        <label>Упражнение <select id="d-ex">${exercises.map(({ e, l }) => `<option value="${esc(e.id)}"${e.id === 'pm1' ? ' selected' : ''}>${esc(l.title)} — ${esc(e.title)}</option>`).join('')}</select></label>
        <label>Темп <select id="d-ex-rate"><option>40</option><option selected>60</option><option>90</option><option>120</option><option>180</option></select> ударов/мин</label>
        <button type="button" id="d-ex-play">Играть с метрономом</button>
      </div>
      <div class="lane" id="d-lane"></div>
      <h2>Сведения для бланка</h2>
      <pre class="diag-info" id="d-info"></pre>
      <div class="row"><button type="button" id="d-copy">Скопировать</button> <span class="small muted" id="d-copy-st"></span></div>
      <p class="small muted">Задержки baseLatency и outputLatency — то, что сообщает браузер. Это не измерение задержки динамика или Bluetooth;
      без отдельного измерения с калибровкой абсолютная задержка неизвестна.</p>
    </div>`;
  const $ = (q) => app.querySelector(q);
  const flash = $('#d-flash');
  const info = () => { $('#d-info').textContent = diagInfoText(); };
  info();
  const stateEl = $('#d-state');
  const laneBox = $('#d-lane');
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
  const stop = () => {
    probe += 1;
    player.stop();
    clearProbe('остановлено');
    info();
  };
  /**
   * Запустить пробу. Звук и экран — только этой пробы: прежняя лента и вспышка
   * убираются до запуска; showLane строит ленту для нового плана, если она применима.
   */
  const startPlan = async (title, plan, { metronomeId = 'off', playStrokes = false, showLane = null } = {}) => {
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
  $('#d-stop').addEventListener('click', stop);
  $('#d-vol').addEventListener('input', (e) => {
    player.setVolume(Number(e.target.value) / 100);
    $('#d-vol-n').textContent = `${e.target.value}%`;
    info();
  });
  const restTimeline = (bpm) => buildCycleTimeline(parsePattern('-', { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols }).beats, bpm);
  $('#d-click').addEventListener('click', () => startPlan('один щелчок', createPlan(restTimeline(60), { maxCycles: 1 }), { metronomeId: 'every1' }));
  app.querySelectorAll('[data-diag-stroke]').forEach((b) => b.addEventListener('click', () => {
    const r = parsePattern(b.dataset.diagStroke, { strokes: C.strokes, subdivision: 1, symbols: C.config.symbols });
    startPlan(`удар ${b.dataset.diagStroke}`, createPlan(buildCycleTimeline(r.beats, 60), { maxCycles: 1 }), { playStrokes: true });
  }));
  $('#d-metro').addEventListener('click', () => {
    const bpm = Number($('#d-metro-rate').value);
    startPlan(`метроном ${bpm}`, createPlan(restTimeline(bpm)), { metronomeId: 'every1' });
  });
  $('#d-ex-play').addEventListener('click', () => {
    const { e, l } = exercises.find((x) => x.e.id === $('#d-ex').value);
    const parsed = parsePattern(e.pattern, { strokes: C.strokes, subdivision: e.subdivision, symbols: C.config.symbols });
    const tech = techniqueReliability(e, l, parsed.slots, strokeMap);
    const ctx = { strokeMap, lanes: C.config.lanes, notes: e.techniqueNotes ?? [], tech: new Map(tech.items.map((i) => [techKey(i), i])) };
    const cues = parsed.slots.map((slot, i) => eventCue({ ...slot, slotIndex: i }, ctx));
    const rateV = Number($('#d-ex-rate').value);
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
  $('#d-copy').addEventListener('click', async () => {
    const text = diagInfoText();
    try {
      await navigator.clipboard.writeText(text);
      $('#d-copy-st').textContent = 'скопировано';
    } catch {
      // Без безопасного соединения буфер обмена недоступен — выделяем текст для ручного копирования.
      const range = document.createRange();
      range.selectNodeContents($('#d-info'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      $('#d-copy-st').textContent = 'буфер недоступен — текст выделен, скопируйте вручную';
    }
  });
}

// ---------- маршруты ----------

// Уборка видимых хвостов страницы (таймеры вспышки и т. п.) при уходе с неё.
let unmountView = null;

function route() {
  endPractice();
  unmountView?.();
  unmountView = null;
  player.setVolume(PLAYER_VOLUME); // громкость диагностики не переносится на уроки
  const [, page, a, b] = (location.hash || '#/').split('/').map(decodeURIComponent);
  document.querySelectorAll('.nav a').forEach((n) => {
    const target = n.getAttribute('href').split('/')[1];
    if ((target || '') === (page === 'lesson' ? '' : page || '')) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  if (page === 'lesson') viewLesson(a, b);
  else if (page === 'strokes') viewStrokes();
  else if (page === 'progress') viewProgress();
  else if (page === 'editor') viewEditor();
  else if (page === 'about') viewAbout();
  else if (page === 'sound') viewSound();
  else viewCatalog();
  window.scrollTo(0, 0);
}

// Закрытие или перезагрузка вкладки во время практики — записать полные циклы.
window.addEventListener('pagehide', () => { endPractice(); unmountView?.(); });
// Вкладка скрыта (переключились на другую, погас экран): звук не останавливаем,
// но уже сыгранные полные циклы записываем сразу — вдруг вкладку закроют фоном.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') practice?.checkpoint();
});

loadContent().then(() => {
  window.addEventListener('hashchange', route);
  route();
}).catch((e) => {
  app.innerHTML = `<h1>Не удалось загрузить данные</h1><p class="errors">${esc(e.message)}</p>
    <p>Проверьте подключение к интернету и обновите страницу. Если ошибка повторяется, сообщите о ней автору приложения.</p>`;
});
