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
import { Player } from './audio/engine.js?v=0.2.3';
import { createPlan, positionAtTime } from './audio/transport.js';
import { createLane } from './ui/lane.js?v=0.2.3';
import { createMotion } from './ui/motion.js';
import { handSvg } from './ui/hand.js?v=0.2.3';
import { eventCue, techKey } from './model/cue.js';
import { METRONOME_MODES } from './audio/scheduler.js';
import { renderStaff, glyphSvg } from './ui/staff.js';
import { followScrollLeft } from './ui/follow.js';
import { createPracticeRun } from './model/practice-run.js';
import { techniqueReliability } from './model/reliability.js';

const APP_VERSION = '0.2.3';
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
// Идущая практика (одна на страницу): end() записывает полные циклы и
// останавливает звук, checkpoint() записывает их, не останавливая.
let practice = null;

function endPractice() {
  practice?.end();
  practice = null;
  player.stop();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  C = { ...C, modules: C.modules.map((m) => ({ ...m,
    title: m.id === 'm5' ? 'Упражнение с метрономом' : m.title,
    lessons: m.lessons.map((l) => l.id === 'care'
      ? { ...l, title: 'Настройка и уход', summary: 'Настройка инструмента и комфорт во время игры.',
          steps: ['Для изменения натяжения мембран обратитесь к мастеру.', 'Следите за свободой движений и комфортом рук.'] }
      : l.id === 'note-kenana'
        ? { ...l, summary: 'Восемь слогов с басовыми акцентами на первом, четвёртом и седьмом ударах. Группировка: 3 + 3 + 2.' }
        : l),
  })) };
  strokeMap = new Map(C.strokes.map((s) => [s.id, s]));
}

function saveProgress(p) {
  progress = p;
  store.set(KEYS.progress, p);
}

// ---------- общие элементы ----------

function feelChip(feelId) {
  const f = C.config.feels?.find((x) => x.id === feelId);
  return f?.status === 'confirmed' ? `<span class="chip feel">${esc(f.label)}</span>` : '';
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

function strokeCard(s) {
  const described = s.status === 'confirmed' && !s.conflict;
  const hand = described && s.hand?.status === 'confirmed' && s.hand.shape !== 'unknown' ? s.hand : null;
  return `<article class="card stroke-card">
    ${glyphIcon(s)}
    <div>
      <div class="label">${esc(s.label)}</div>
      ${described ? `<div class="small muted">${esc(laneLabel(s.lane))}</div><p class="small">${esc(s.technique)}</p>` : ''}
      ${hand ? `<div class="hand-hint small">${handSvg(hand, { lane: s.lane === 'left' ? 'left' : 'right', size: 32 })}
        <span>${esc(hand.hint)}</span></div>` : ''}
      <div class="meta"><button type="button" data-hear="${esc(s.id)}" title="Синтезированный звук">Послушать</button></div>
    </div>
  </article>`;
}

// A student should never be taught a disputed finger assignment as established.
// Keep the syllable/audio for practice, but omit that hand illustration.
function practiceCue(slot, ctx) {
  const cue = eventCue(slot, ctx);
  if (cue.kind !== 'stroke') return cue;
  const disputed = cue.notes.some((n) => n.status !== 'confirmed');
  const parts = cue.parts.filter((p) => !disputed && p.hand.status === 'confirmed' &&
    strokeMap.get(p.strokeId)?.status === 'confirmed' && !strokeMap.get(p.strokeId)?.conflict);
  const complete = parts.length === cue.parts.length;
  return { ...cue, parts: complete ? parts : [],
    combos: complete ? cue.combos.filter((c) => c.hand?.status === 'confirmed') : [],
  };
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
    <p class="muted">Выберите урок, начните в медленном темпе и следуйте подсказкам ленты.</p>
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
          <div class="meta">${feelChip(l.feel)}${prog}</div>
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
  for (const e of lesson.exercises) {
    const r = parsePattern(e.pattern, { strokes: C.strokes, subdivision: e.subdivision, symbols: C.config.symbols });
    r.slots.forEach((s) => s.strokes.forEach((id) => usedIds.add(id)));
  }
  const sm = lessonSummary(progress, lesson);

  app.innerHTML = `
    <p class="small"><a href="#/">← Уроки</a> · ${esc(lesson.module.title)}</p>
    <div class="lesson-head">
      <h1>${esc(lesson.title)}</h1>
      <div class="meta row">${feelChip(lesson.feel)}</div>
      <p>${esc(lesson.summary)}</p>
    </div>
    ${lesson.steps?.length ? `<h2>Как заниматься</h2><ol>${lesson.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${ex ? `<h2>Упражнение</h2>
      ${lesson.exercises.length > 1 ? `<div class="tabs" role="tablist">${lesson.exercises.map((e) =>
        `<a role="tab" class="chip plain" aria-selected="${e.id === ex.id}" href="#/lesson/${encodeURIComponent(lesson.id)}/${encodeURIComponent(e.id)}"${e.id === ex.id ? ' style="color:var(--accent)"' : ''}>${esc(e.title)}</a>`).join('')}</div>` : ''}
      <div id="exercise"></div>` : '<p class="muted">В этом уроке нет ритмических упражнений.</p>'}
    ${usedIds.size ? `<h2>Удары урока</h2><div class="grid">${[...usedIds].map((id) => strokeCard(strokeMap.get(id), { withSources: false })).join('')}</div>` : ''}
    <h2>Отметка</h2>
    <label><input type="checkbox" id="lesson-done" ${sm.done ? 'checked' : ''}> Урок пройден (самооценка)</label>
  `;
  if (ex) mountExercise(document.getElementById('exercise'), ex, { lesson });
  app.querySelector('#lesson-done').addEventListener('change', (e) => saveProgress(setLessonDone(progress, lesson.id, e.target.checked)));
  bindHearButtons(app);
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
  const lanes = C.config.lanes.filter((l) => l.id !== 'unknown' || usedLanes.has('unknown'))
    .map((l) => l.id === 'unknown' ? { ...l, label: 'Слоги' } : l);
  const defaults = C.defaults ?? { slowRate: 60, fastFactor: 2, ladder: { from: 30, to: 90, step: 10 } };
  const slow = ex.tempo?.slow ?? defaults.slowRate;
  const fast = Math.round(slow * (defaults.fastFactor ?? 2));
  const ladderRates = tempoLadder(defaults.ladder.from, defaults.ladder.to, defaults.ladder.step);
  const prog = () => exerciseProgress(progress, ex.id);
  const perCycle = countStrokes(parsed.slots);
  // Подсказка для каждой поддоли рисунка — по удару события, а не по слогу.
  const tech = techniqueReliability(ex, lesson, parsed.slots, strokeMap);
  const cueCtx = {
    strokeMap, lanes: C.config.lanes, notes: ex.techniqueNotes ?? [],
    tech: new Map(tech.items.map((i) => [techKey(i), i])),
  };
  const cues = parsed.slots.map((slot, i) => practiceCue({ ...slot, slotIndex: i }, cueCtx));
  const viewName = `view-${ex.id}-${sandbox ? 'sb' : 'ex'}`;

  root.innerHTML = `
    <div class="view-switch" role="radiogroup" aria-label="Вид упражнения">
      <label><input type="radio" name="${viewName}" value="moving"> Лента</label>
      <label><input type="radio" name="${viewName}" value="static"> Без движения</label>
      <label><input type="radio" name="${viewName}" value="staff"> Полная запись</label>
    </div>
    <div class="practice-sticky">
      <div class="lane" id="lane" aria-label="Лента ударов: текущий и следующие по записи"></div>
      <div class="row play-row">
        <div class="transport" role="group" aria-label="Воспроизведение">
          <button type="button" class="primary" id="play">▶ Играть</button>
          <button type="button" id="pause" disabled>Ⅱ Пауза</button>
          <button type="button" id="stop" disabled>■ Стоп</button>
        </div>
        <span class="small playback-state" id="playback-state" role="status">Готово к игре</span>
        <div class="now-syl" id="now" aria-hidden="true">—</div>
        <div class="counters" aria-live="polite">
          <div class="counter">Удары<b id="c-strokes">0</b></div>
          <div class="counter">Циклы<b id="c-cycles">0</b></div>
        </div>
      </div>
      <p class="small tempo-msg" id="tempo-msg" aria-live="polite"></p>
    </div>
    <p class="small muted lane-note">Следите за текущим и следующими ударами. Число на ладони обозначает количество пальцев.
      «Пауза» сохраняет место, «Стоп» возвращает к началу.</p>
    <div class="staff-block">
      <div class="staff-wrap">${renderStaff({ beats: parsed.beats, strokeMap, lanes, grouping: ex.grouping, title: `Запись: ${ex.title}` })}</div>
      <div class="staff-legend">${lanes.map((l, i) => `<span>Линия ${i + 1}: ${esc(l.label)}</span>`).join('')}
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
        <label title="Синтезированный звук ударов"><input type="checkbox" id="synth" checked> Звук ударов</label>
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
  const pause = $('#pause');
  const stop = $('#stop');
  const state = $('#playback-state');
  const wrap = $('.staff-wrap');
  const syncControls = () => {
    play.textContent = player.paused ? '▶ Продолжить' : '▶ Играть';
    play.disabled = Boolean(run) && !player.paused || player.starting;
    pause.disabled = !run || !player.playing || player.starting;
    stop.disabled = !run;
    cyclesSel.disabled = Boolean(run);
    metro.disabled = Boolean(run);
    $('#synth').disabled = Boolean(run);
    state.textContent = !run ? 'Готово к игре' : player.starting ? 'Включаю звук…' : player.paused ? 'На паузе' : 'Играет';
  };

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
    player.stop();
    commit(true);
    run = null;
    motion.sync();
    if (practice?.root === root) practice = null;
    syncControls();
    highlight(-1);
    $('#now').textContent = '—';
    $('#c-strokes').textContent = '0';
    $('#c-cycles').textContent = '0';
    tempoMsg.textContent = '';
    wrap.scrollLeft = 0;
    // Лента возвращается к началу: первые удары следующего запуска.
    lane.setPlan(previewPlan());
    lane.setPosition(-1);
  };
  pause.addEventListener('click', () => {
    if (!run || !player.pause()) return;
    commit(false);
    if (view === 'moving' && !reducedMotion()) lane.setPosition(positionAtTime(player.plan, player.now()));
    motion.sync();
    syncControls();
  });
  stop.addEventListener('click', () => {
    if (!run) return;
    player.stop();
    finish();
  });
  play.addEventListener('click', async () => {
    if (run) {
      if (!player.paused || player.starting) return;
      const thisRun = run;
      const pending = player.resume();
      syncControls();
      const status = await pending;
      if (run !== thisRun) return;
      syncControls();
      motion.sync();
      if (status === 'failed') tempoMsg.textContent = startFailureText();
      else if (tempoMsg.textContent === startFailureText()) tempoMsg.textContent = '';
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
    lane.setPlan(plan);
    lane.setPosition(-1);
    const thisRun = run;
    $('#now').textContent = 'включаю звук…';
    const pending = player.start({
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
    syncControls();
    const status = await pending;
    if (run !== thisRun) return; // за время ожидания нажали «Стоп» или ушли со страницы
    if (status !== 'started') {
      // Браузер отказал (или запуск отменён в обход этой кнопки): интерфейс — в исходное.
      finish();
      if (status === 'failed') tempoMsg.textContent = startFailureText();
      return;
    }
    if ($('#now').textContent === 'включаю звук…') $('#now').textContent = '—';
    syncControls();
    motion.sync();
  });
}

function viewStrokes() {
  app.innerHTML = `<h1>Удары</h1>
    <p class="muted">Названия ударов и подсказки для рук. Нажмите «Послушать», чтобы услышать синтезированный звук.</p>
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
  app.innerHTML = `<h1>О приложении</h1>
    <p>«Мриданга» помогает разучивать ритмические мантры: следуйте ленте ударов, выбирайте темп и занимайтесь с метрономом.</p>
    <h2>Как заниматься</h2>
    <p>Начните медленно. На ленте видны текущий и следующие удары. Нажмите «Паузу», чтобы разобрать нужное место, и «Продолжить», чтобы вернуться к игре. «Стоп» начинает упражнение заново.</p>
    <p>Звук ударов синтезирован. В упражнениях используется равномерный учебный пульс для разучивания последовательности слогов.</p>
    <p>Повторения отмечайте самостоятельно. Счётчики учитывают воспроизведение упражнения. Прогресс сохраняется в этом браузере.</p>
    <h2>Материалы курса</h2>
    <p>Основа программы — видеокурс «Mridanga Lessons», scsmath, Sadhu Priya das.</p>`;
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
      <div class="diag-sounds">${C.strokes.map((st) => `<button type="button" data-diag-stroke="${esc(st.id)}" >${esc(st.label)}</button>`).join('')}</div>
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
      <details><summary>Сведения о звуке</summary>
      <pre class="diag-info" id="d-info"></pre>
      <div class="row"><button type="button" id="d-copy">Скопировать</button> <span class="small muted" id="d-copy-st"></span></div>
      <p class="small muted">Задержки baseLatency и outputLatency — то, что сообщает браузер. Это не измерение задержки динамика или Bluetooth;
      без отдельного измерения с калибровкой абсолютная задержка неизвестна.</p></details>
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
    startPlan(`удар ${strokeMap.get(b.dataset.diagStroke).label}`, createPlan(buildCycleTimeline(r.beats, 60), { maxCycles: 1 }), { playStrokes: true });
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
    const cues = parsed.slots.map((slot, i) => practiceCue({ ...slot, slotIndex: i }, ctx));
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
