// экран «День»: собственный таймлайн (рутины и поставленные дела) вместо
// календарной сетки. Расстановка: тапом по пустому часу (основной способ,
// работает и на телефоне), перетаскиванием карточки, растягиванием за нижний
// край, кликом в колонке дел или автоматически.

import { getPractices, getTasks, updateTask, deleteTask, getAllSpheres, completeTask, savePractice, deletePractice, saveTask, getDataOwner } from '../core/storage.js';
import type { TaskPatch } from '../core/storage.js';
import { categorize } from '../core/categorize.js';
import { breakdownWithLlm } from '../ai/llmClient.js';
import { practiceAppliesOn, minutesToTime, timeToMinutes, tsToLocalInput, todayStr, addDays } from '../core/schedule.js';
import {
  buildDay, computeFreeWindows, practicesToBlocks,
  adaptiveSort, autoPlaceLimit, recommendNow,
} from '../core/dayPlan.js';
import type { Energy, FreeWindow, Occupancy, Recommendation } from '../core/dayPlan.js';
import { GROUP_COLORS } from '../core/calendarEvents.js';
import { dayStats } from '../core/analytics.js';
import { Practice, Task } from '../core/models.js';
import type { Sphere, SphereGroup } from '../core/models.js';
import { t, getLang } from '../core/i18n.js';
import {
  escapeHtml, daysCheckboxes, groupOptions, timeRangeFields, timeInput,
  normalizeTimeValue, bindTimeMasks, remindFieldsHtml, handleRemindClick, readRemindInput,
  sphereColor, repeatFieldsHtml, saveParsedTask, presetChipKeys,
} from './dom.js';
import { installClickGuard, DRAG_PX } from './gesture.js';

const ENERGY_KEY = 'daylik-energy';
const WELCOME_KEY = 'daylik-welcome';

const MINUTES = 1440;
const DRAG_PX_PER_MIN = 1; // вертикальное перетаскивание карточки меняет время

// блок таймлайна: рутина (от практики) или поставленное дело
type RoutineBlock = Occupancy & { kind: 'routine'; taskId?: undefined; group?: undefined; sphereId?: undefined };
type TaskBlock = {
  start: number;
  end: number;
  kind: 'task';
  label: string;
  taskId: string;
  group: SphereGroup;
  sphereId: string | null;
};
type TimelineBlock = RoutineBlock | TaskBlock;

interface DayState {
  date: string;
  routines: Occupancy[];
  scheduled: Task[];
  unscheduled: Task[];
  blocks: TimelineBlock[];
  windows: FreeWindow[];
  allTasks: Task[];
  practices: Practice[];
  todo: Task[];
  spheres: Sphere[];
  sphereNames: Record<string, string>;
  sphereColors: Record<string, string>;
}

type MoveGesture = {
  type: 'move';
  id: string;
  startX: number;
  startY: number;
  startMin: number;
  durMin: number;
  moved: boolean;
  card: HTMLElement;
  ghost?: HTMLElement | null;
  newStart?: number;
  toSide?: boolean;
};

type SideGesture = {
  type: 'side';
  id: string;
  task: Task;
  startX: number;
  startY: number;
  moved: boolean;
  ghost: HTMLElement | null;
  dropRow?: HTMLElement | null;
};

type Gesture = MoveGesture | SideGesture;

// длительность словами: '1 ч 30 м'
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ч${m ? ` ${m} м` : ''}` : `${m} м`;
}

function todayWeekday(): number {
  return ((new Date().getDay() + 6) % 7) + 1; // 1 = понедельник
}

function loadEnergy(): Energy {
  try {
    const v = localStorage.getItem(ENERGY_KEY);
    return v === 'low' || v === 'high' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

function saveEnergy(v: Energy): void {
  try {
    localStorage.setItem(ENERGY_KEY, v);
  } catch {
    // сохранение не критично
  }
}

// короткая инструкция показывается один раз; если хранилище недоступно —
// не показываем, чтобы не раздражать постоянной карточкой
function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return true;
  }
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// поставленное дело как отрезок занятости таймлайна
const occOf = (x: Task): { start: number; end: number; label: string } => ({
  start: x.scheduledStart as number,
  end: (x.scheduledStart as number) + x.durationMin,
  label: x.title,
});

export function initDayScreen(root: HTMLElement): void {
  let editing: string | null = null;   // id редактируемого дела
  let state: DayState | null = null;   // данные текущей отрисовки
  let energy: Energy = loadEnergy();
  let whatNow: Recommendation | 'empty' | null = null;   // рекомендация «что сейчас»
  let whatNowAuto = true; // подсказка показывается сама, пока пользователь не закроет её
  let skipIds = new Set<string>(); // «не это»: дела, снятые с рекомендаций в этой сессии
  let editPractice: string | null = null; // id редактируемого блока дня (рутины)
  let pickAt: number | null = null;    // минута выбранного на таймлайне окна (выбор дела)
  let scrolledToNow = false;

  // таймер работы над делом: внешний каркас времени (как в Routinery/Tiimo).
  // Хранится в localStorage — переживает перезагрузку страницы
  let timer: { taskId: string; end: number } | null = null;
  let timerTick: ReturnType<typeof setInterval> | null = null;
  try {
    const raw = localStorage.getItem('daylik-timer:' + getDataOwner());
    if (raw) timer = JSON.parse(raw);
  } catch {
    // битая запись таймера — просто нет таймера
  }
  const saveTimer = () => {
    try {
      if (timer) localStorage.setItem('daylik-timer:' + getDataOwner(), JSON.stringify(timer));
      else localStorage.removeItem('daylik-timer:' + getDataOwner());
    } catch {
      // сохранение не критично
    }
  };
  const clearTimer = () => {
    timer = null;
    if (timerTick) clearInterval(timerTick);
    timerTick = null;
    saveTimer();
  };

  // каркас живёт всё время экрана: шапка и колонка перерисовываются,
  // таймлайн перерисовывается вместе с ними
  root.innerHTML = `
    <div id="day-top"></div>
    <div class="day-wrap">
      <div id="cal-wrap"><div class="tl-scroll" id="tl-scroll"></div></div>
      <div class="side" id="side"></div>
    </div>
    <div id="day-modal" hidden></div>`;

  const topEl = root.querySelector<HTMLElement>('#day-top')!;
  const sideEl = root.querySelector<HTMLElement>('#side')!;
  const modalEl = root.querySelector<HTMLElement>('#day-modal')!;
  const scrollEl = root.querySelector<HTMLElement>('#tl-scroll')!;

  bindTimeMasks(root);
  installClickGuard(root);

  // сбор данных и отрисовка

  let renderGen = 0; // счётчик отрисовок: устаревшая (параллельная) не трогает DOM

  async function render(): Promise<void> {
    const gen = ++renderGen;
    // набранный, но не отправленный текст быстрого ввода переживает перерисовку
    const quickVal = root.querySelector<HTMLInputElement>('#quick-add')?.value || '';

    const date = todayStr();
    const practices = (await getPractices()).filter((p) => practiceAppliesOn(p, todayWeekday()));

    const todo = await getTasks({ status: 'todo' });
    const done = (await getTasks({ status: 'done' })).sort((a, b) => b.createdAt - a.createdAt);
    const spheres = await getAllSpheres();
    const allTasks = [...todo, ...done];
    const editTask = editing ? allTasks.find((x) => x.id === editing) : null;
    if (editing && !editTask) editing = null;
    // запланированное = дата + конкретное время; отложенное «на завтра» без
    // времени завтра вернётся в колонку дел, а не сломает календарь
    const scheduled = todo
      .filter((x) => x.scheduledDate === date && x.scheduledStart != null)
      .sort((a, b) => (a.scheduledStart as number) - (b.scheduledStart as number));
    // сегодняшняя колонка дел: без даты или «на сегодня без времени»;
    // завтрашние не давят, вчерашние живут в баннере хвостов
    const unscheduled = todo.filter((x) => !x.scheduledDate || (x.scheduledDate === date && x.scheduledStart == null));

    const blocks: TimelineBlock[] = [
      ...practicesToBlocks(practices).map((r) => ({ ...r, kind: 'routine' as const })),
      ...scheduled.map((x) => ({ ...occOf(x), kind: 'task' as const, taskId: x.id, group: x.group, sphereId: x.sphereId })),
    ].sort((a, b) => a.start - b.start);
    // пока читали базу, началась более свежая отрисовка — эту бросаем
    if (gen !== renderGen) return;

    const windows = computeFreeWindows(blocks);
    const fits = (x: Task) => windows.some((w) => w.end - w.start >= x.durationMin);
    const placeable = adaptiveSort(unscheduled.filter(fits), energy);
    const notFitting = unscheduled.filter((x) => !fits(x));
    const overdue = todo.filter((x) => x.scheduledDate && x.scheduledDate < date);
    const routines = practices.map((p) => ({ start: p.start, end: p.end, label: p.title }));
    const stats = dayStats(date, todo, done, practices);
    const fmt = (min: number) => `${Math.floor(min / 60)}ч ${String(min % 60).padStart(2, '0')}м`;

    state = { date, routines, scheduled, unscheduled, blocks, windows, allTasks, practices, todo,
      spheres,
      sphereNames: Object.fromEntries(spheres.map((s) => [s.id, s.name])),
      sphereColors: Object.fromEntries(spheres.map((s) => [s.id, sphereColor(s.id)])) };

    // автоподсказка «что сейчас»: показываем сами, пока пользователь не закрыл;
    // снятые «не это» дела в рекомендации не возвращаются
    if (!whatNow && whatNowAuto && placeable.length) {
      const rec = recommendNow(state.windows,
        state.unscheduled.filter((x) => !skipIds.has(x.id)), nowMinutes(), energy);
      if (rec) whatNow = rec;
    }

    scrollEl.innerHTML = timelineHtml(blocks, windows);
    // прокрутка к разделителю «сейчас» внутри ленты: scrollIntoView тянул
    // за собой всю страницу и уводил шапку с экрана
    if (!scrolledToNow && scrollEl.offsetHeight > 0) {
      scrolledToNow = true;
      const nowRow = scrollEl.querySelector<HTMLElement>('.tl-now-row');
      if (nowRow) {
        const top = nowRow.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
        scrollEl.scrollTop = Math.max(0, top - scrollEl.clientHeight / 2);
      }
    }

    // шапка дня: «Сегодня» + локализованная дата
    const dateLabel = new Date().toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'ru-RU',
      { weekday: 'long', day: 'numeric', month: 'long' });

    // режим «мало сил»: экран сжимается — без перегруз-предупреждений,
    // колонка дел режется до трёх, фокус-карточка говорит «достаточно и одного»
    const low = energy === 'low';

    topEl.innerHTML = `
      <div class="day-head">
        <div>
          <h2>${t('day.title')}</h2>
          <p class="day-date">${dateLabel}</p>
        </div>
      </div>
      ${timerHtml()}
      ${welcomeSeen() ? '' : `
      <div class="card welcome">
        <strong>${t('welcome.title')}</strong>
        <ol>
          <li>${t('welcome.step1')}</li>
          <li>${t('welcome.step2')}</li>
          <li>${t('welcome.step3')}</li>
        </ol>
        <button id="welcome-ok">${t('welcome.ok')}</button>
      </div>`}
      <div class="input-row">
        <input id="quick-add" placeholder="${t('day.quickAdd')}">
        <button id="quick-save" class="secondary">+</button>
      </div>
      <p id="quick-msg" class="muted"></p>
      <div class="day-tools">
        <div class="energy-block">
          <span class="energy-label">${t('energy.label')}</span>
          <div class="energy-pick" role="group" aria-label="${t('energy.label')}">
            ${(['low', 'normal', 'high'] as Energy[]).map((e) =>
              `<button class="energy${e === energy ? ' on' : ''}" data-energy="${e}"
                aria-pressed="${e === energy}">${t(`energy.${e}`)}</button>`).join('')}
          </div>
        </div>
        <button id="what-now" class="what-now-btn">${t('day.whatNow')}</button>
        <p class="energy-hint muted">${t(`energy.hint.${energy}`)}</p>
      </div>
      ${whatNow === 'empty' ? `<div class="card"><p class="muted">${t('day.whatNowEmpty')}</p></div>` : whatNow ? whatNowHtml(whatNow) : ''}
      <p class="muted">${stats.summary}${todo.length || routines.length ? '' : ` — ${t('day.emptyHint')}`}</p>
      ${!low && stats.overloadMin > 0 ? `<p class="overload">${t('day.overload', { time: fmt(stats.overloadMin) })}</p>` : ''}
      ${overdue.length ? `
      <div class="card overdue-box">
        <span>${t('day.overdue', { n: overdue.length })}</span>
        <button id="overdue-return" class="secondary">${t('day.overdueReturn')}</button>
      </div>` : ''}`;
    const qa = root.querySelector<HTMLInputElement>('#quick-add');
    if (qa && quickVal) qa.value = quickVal;

    // карточки правки (дело, блок дня) и выбор дела на время живут в модальном окне
    const modalHtml = editTask
      ? editCardHtml(editTask, spheres)
      : (editPractice !== null
        ? routineEditorHtml(state.practices.find((p) => p.id === editPractice))
        : (pickAt !== null ? pickerHtml(pickAt) : ''));
    modalEl.hidden = !modalHtml;
    modalEl.innerHTML = modalHtml ? `<div class="modal-overlay"><div class="modal-card">${modalHtml}</div></div>` : '';

    // режим «мало сил»: колонка режется до трёх дел, остальные — за details
    // (никуда не денутся, просто не давят); «норм»/«много» — как раньше
    const shown = low ? placeable.slice(0, 3) : placeable;
    const hiddenCount = placeable.length - shown.length;

    sideEl.innerHTML = `
      <div class="side-head">
        <h3>${t('day.tasks')}</h3>
        <button id="auto-place" class="secondary">${t('day.autoPlace')}</button>
      </div>
      ${unscheduled.length
        ? [...shown, ...notFitting].map((x) => taskRowHtml(x, fits(x))).join('')
          + (hiddenCount > 0 ? `
      <details class="more-params col-more">
        <summary>${t('day.colMore', { n: hiddenCount })}</summary>
        ${placeable.slice(3).map((x) => taskRowHtml(x, fits(x))).join('')}
      </details>` : '')
        : `<div class="col-empty">
            <p class="muted">${t('day.startOne')}</p>
            <div class="chips">
              ${presetChipKeys().map((key) => `<button type="button" class="grp chip" data-empty-preset="${key}">${t(key)}</button>`).join('')}
            </div>
          </div>`}
      ${done.length ? `
      <div class="done-list">
        <span class="done-title">${t('day.doneToday')}</span>
        ${done.slice(0, 3).map(doneItemHtml).join('')}
        ${done.length > 3 ? `
        <details class="done-box">
          <summary>${t('day.doneMore', { n: done.length - 3 })}</summary>
          ${done.slice(3, 18).map(doneItemHtml).join('')}
        </details>` : ''}
      </div>` : ''}`;
    startTimerTick();
  }

  // общая подпись дела: название, длительность, метка направления; цвет
  // направления живёт в кайме строки (taskRowHtml) — не вплотную к тексту
  const taskLabel = (task: Task, suffix = ''): string =>
    `${task.repeatRule ? '<span class="routine-mark">↻</span>' : ''}${escapeHtml(task.title)} <span class="muted">${task.durationMin} ${t('task.minutes')}`
    + (task.sphereId && state!.sphereNames[task.sphereId] ? ` · ${escapeHtml(state!.sphereNames[task.sphereId])}` : '')
    + `${suffix}</span>`;

  const doneItemHtml = (task: Task): string => {
    const c = task.sphereId && state!.sphereColors[task.sphereId];
    return `<button class="done-item" data-id="${task.id}" title="${t('task.return')}"${c ? ` style="--task-c:${c}"` : ''}>${taskLabel(task)}</button>`;
  };

  function taskRowHtml(task: Task, canPlace: boolean): string {
    // не влезающее дело остаётся кликабельным — встанет в первое окно
    // с перекрытием (оценка времени приблизительна, это нормально)
    const label = taskLabel(task, canPlace ? '' : ` — ${t('day.notFit')}`);
    const sphereC = task.sphereId && state!.sphereColors[task.sphereId];
    return `
      <div class="task-row${canPlace ? '' : ' dimmed'}" data-id="${task.id}" data-g="${task.group}"${sphereC ? ` style="--task-c:${sphereC}"` : ''}>
        <button class="side-task" data-id="${task.id}"
          title="${canPlace ? t('task.putFirst') : t('task.putOverlap')}">${label}</button>
        <button class="edit-btn" data-id="${task.id}" title="${t('task.editTip')}">✎</button>
        <button class="done-btn" data-id="${task.id}" title="${t('task.markDone')}">✓</button>
      </div>`;
  }

  function editCardHtml(task: Task, spheres: Sphere[]): string {
    return `
      <div class="card">
        <div class="row between">
          <strong>${t('task.edit')}</strong>
          <button id="edit-close" class="secondary">${t('common.close')}</button>
        </div>
        <label>${t('common.title')} <input id="e-title" value="${escapeHtml(task.title)}"></label>
        <div class="row">
          <label>${t('task.duration')} <input id="e-dur" type="number" min="5" max="480" step="5" value="${task.durationMin}"></label>
          <label>${t('common.group')}
            <select id="e-group">${groupOptions(task.group)}</select>
          </label>
        </div>
        <label>${t('task.startTime')}
          ${timeInput('js-estart', task.scheduledDate === todayStr() && task.scheduledStart != null ? minutesToTime(task.scheduledStart) : '', true)}
          <span class="muted">${t('task.startTimeHint')}</span>
        </label>
        <details class="more-params" ${task.dueAt || task.repeatRule || task.sphereId ? 'open' : ''}>
          <summary>${t('task.moreParams')}</summary>
          <p class="muted">${t('task.moreParamsHint')}</p>
          <label>${t('task.remind')}</label>
          ${remindFieldsHtml('e', (() => {
            const dt = tsToLocalInput(task.dueAt);
            const [d, tm] = dt ? dt.split('T') : ['', '09:00'];
            return { date: d, time: tm, open: Boolean(task.dueAt) };
          })())}
          <div class="row">
            ${repeatFieldsHtml('e', task.repeatRule)}
          </div>
          <label>${t('common.sphere')}
            <select id="e-sphere">
              <option value="">${t('task.noSphere')}</option>
              ${spheres.map((s) =>
                `<option value="${s.id}"${s.id === task.sphereId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </label>
        </details>
        <div class="row">
          <button id="e-save" data-id="${task.id}">${t('common.save')}</button>
          <button id="e-tomorrow" data-id="${task.id}" class="secondary">${t('task.tomorrow')}</button>
          <button id="e-delete" data-id="${task.id}" class="danger">${t('task.deleteBtn')}</button>
        </div>
        ${task.durationMin >= 60 ? `
        <div class="row">
          <button id="e-breakdown" data-id="${task.id}" class="secondary">${t('task.breakdown')}</button>
          <span id="e-msg" class="muted"></span>
        </div>` : ''}
      </div>`;
  }

  // карточка блока дня: правка существующей рутины (создание — на «Направлениях»)
  function routineEditorHtml(p: Practice | undefined): string {
    return `
      <div class="card">
        <div class="row between">
          <strong>${t('routine.edit')}</strong>
          <button id="routine-close" class="secondary">${t('common.close')}</button>
        </div>
        <p class="muted">${t('routine.hint')}</p>
        <label>${t('common.title')} <input id="r-title" value="${escapeHtml(p?.title || '')}" placeholder="${t('input.placeholder')}"></label>
        ${timeRangeFields(p ? minutesToTime(p.start) : '23:00', p ? minutesToTime(p.end) : '07:00')}
        <div class="days">${daysCheckboxes(p?.days)}</div>
        <div class="row">
          <button id="routine-save" data-id="${p?.id || ''}">${t('common.save')}</button>
          ${p ? `<button id="routine-delete" data-id="${p.id}" class="danger">${t('common.delete')}</button>` : ''}
        </div>
      </div>`;
  }

  // остаток таймера строкой: М:СС, после нуля — мягкая фраза
  const fmtLeft = (ms: number) => {
    if (ms <= 0) return t('day.timerOver');
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // карточка «В работе»: одна задача и живой обратный отсчёт.
  // Дело исчезло или закрыто — таймер молча снимается
  function timerHtml(): string {
    if (!timer || !state) return '';
    const task = state.allTasks.find((x) => x.id === timer!.taskId && x.status === 'todo');
    if (!task) {
      clearTimer();
      return '';
    }
    const dot = task.sphereId && state.sphereColors[task.sphereId]
      ? `<span class="sphere-dot big" style="background:${state.sphereColors[task.sphereId]}"></span>` : '';
    return `
      <div class="card focus-card timer-card">
        <span class="focus-label">${t('day.timerOn')}</span>
        <div class="focus-task">
          ${dot}<strong>${escapeHtml(task.title)}</strong>
          <span class="muted" id="timer-left">${fmtLeft(timer.end - Date.now())}</span>
        </div>
        <div class="row">
          <button id="timer-done" data-id="${task.id}">${t('task.markDone')}</button>
          <button id="timer-more" class="secondary">${t('day.timerMore')}</button>
          <button id="timer-stop" class="secondary">${t('day.timerStop')}</button>
        </div>
      </div>`;
  }

  // секундный тик обновляет только текст отсчёта, без перерисовки экрана
  function startTimerTick(): void {
    if (timerTick) clearInterval(timerTick);
    if (!timer) return;
    timerTick = setInterval(() => {
      const el = root.querySelector('#timer-left');
      if (!el || !timer) return;
      el.textContent = fmtLeft(timer.end - Date.now());
    }, 1000);
  }

  function whatNowHtml(rec: Recommendation): string {
    const dot = rec.task.sphereId && state!.sphereColors[rec.task.sphereId]
      ? `<span class="sphere-dot big" style="background:${state!.sphereColors[rec.task.sphereId]}"></span>` : '';
    return `
      <div class="card focus-card">
        <span class="focus-label">${energy === 'low' ? t('day.focusSingle') : t('day.whatNow')}</span>
        <div class="focus-task">
          ${dot}<strong>${escapeHtml(rec.task.title)}</strong>
          <span class="muted">${t('day.whatNowHint', { b: minutesToTime(rec.end), dur: rec.task.durationMin, title: rec.task.title })}</span>
        </div>
        <div class="row">
          <button id="whatnow-start" data-id="${rec.task.id}">${t('day.timerGo')}</button>
          <button id="whatnow-place" data-id="${rec.task.id}" data-start="${rec.start}" class="secondary">${t('day.whatNowPlace')} ${minutesToTime(rec.start)}</button>
          <button id="whatnow-skip" class="secondary">${t('day.whatNowSkip')}</button>
          <button id="whatnow-close" class="secondary">${t('common.close')}</button>
        </div>
      </div>`;
  }

  // день как вертикальный список (по образцу Sunsama): строки блоков в
  // порядке времени, между ними — свободные окна с кнопкой постановки,
  // разделитель «сейчас». Высота строки не зависит от длительности.
  function timelineHtml(blocks: TimelineBlock[], windows: FreeWindow[]): string {
    const items = [
      ...blocks.map((b) => ({ type: 'block' as const, start: b.start, b })),
      ...windows.map((w) => ({ type: 'free' as const, start: w.start, end: w.end })),
    ].sort((a, b) => a.start - b.start || (a.type === 'free' ? -1 : 1));

    const now = nowMinutes();
    const rows: string[] = [];
    let nowPlaced = false;
    const pushNow = () => {
      rows.push(`<div class="tl-row tl-now-row" data-now="${now}">
        <div class="tl-t">${minutesToTime(now)}</div><div class="tl-now-line"></div>
      </div>`);
      nowPlaced = true;
    };

    for (const item of items) {
      if (!nowPlaced && item.start > now) pushNow();
      if (item.type === 'free') {
        if (item.end - item.start >= 15) {
          rows.push(`<div class="tl-row" data-start="${item.start}">
            <div class="tl-t">${minutesToTime(item.start)}</div>
            <button class="tl-free" data-min="${item.start}" title="${t('day.tapHint')}">
              <span>${t('day.free', { time: fmtDur(item.end - item.start) })}</span><span class="tl-plus">+</span>
            </button>
          </div>`);
        }
        continue;
      }
      const b = item.b;
      const past = b.end <= now;
      const current = b.start <= now && now < b.end;
      const remain = current ? ` · ${t('day.remaining', { min: fmtDur(b.end - now) })}` : '';
      const cls = `${past ? ' past' : ''}${current ? ' tl-current' : ''}`;
      if (b.kind === 'routine') {
        const p = state!.practices.find((x) => x.id === b.id);
        const color = p?.sphereId ? state!.sphereColors[p.sphereId] : '';
        rows.push(`<div class="tl-row${cls}" data-start="${b.start}">
          <div class="tl-t">${minutesToTime(b.start)}</div>
          <div class="tl-card routine" data-practice="${b.id}"${color ? ` style="border-left-color:${color}"` : ''}>
            <span class="tl-title">↻ ${escapeHtml(b.label)}</span>
            <span class="tl-dur">${minutesToTime(b.start)}–${minutesToTime(Math.min(b.end, MINUTES))}${remain}</span>
          </div>
        </div>`);
      } else {
        const color = (b.sphereId ? state!.sphereColors[b.sphereId] : '') || (GROUP_COLORS[b.group] ?? 'var(--accent)');
        rows.push(`<div class="tl-row${cls}" data-start="${b.start}" data-min="${b.start}">
          <div class="tl-t">${minutesToTime(b.start)}</div>
          <div class="tl-card task" data-task="${b.taskId}" data-g="${b.group}" style="background:${color}">
            <span class="tl-title">${escapeHtml(b.label)}</span>
            <span class="tl-dur">${fmtDur(b.end - b.start)}${remain}</span>
          </div>
        </div>`);
      }
    }
    if (!nowPlaced) pushNow();
    return `<div class="tl-list" id="tl-list">${rows.join('')}</div>`;
  }

  // выбор дела на выбранное время: основной способ расстановки — тап,
  // работает и мышью, и пальцем (drag — дополнение для мыши)
  function pickerHtml(startMin: number): string {
    const fits = (x: Task) => x.durationMin <= MINUTES - startMin;
    const list = [...adaptiveSort(state!.unscheduled.filter(fits), energy),
      ...state!.unscheduled.filter((x) => !fits(x))];
    return `
      <div class="card">
        <div class="row between">
          <strong>${t('day.placeAt', { time: minutesToTime(startMin) })}</strong>
          <button id="pick-close" class="secondary">${t('common.close')}</button>
        </div>
        ${list.length ? list.map((x) => {
          const c = x.sphereId && state!.sphereColors[x.sphereId];
          return `
          <button class="pick-task" data-id="${x.id}"${c ? ` style="--task-c:${c}"` : ''}>${taskLabel(x)}
            <span class="muted">${x.durationMin} ${t('task.minutes')}${fits(x) ? '' : ` — ${t('day.notFit')}`}</span>
          </button>`;
        }).join('') : `<p class="muted">${t('day.pickEmpty')}</p>`}
      </div>`;
  }

  async function autoPlace(): Promise<void> {
    const { date, routines, scheduled, unscheduled } = state!;
    const occupancy: Occupancy[] = [...routines, ...scheduled.map(occOf)];
    const limit = autoPlaceLimit(energy);
    const batch = adaptiveSort(unscheduled, energy).slice(0, limit);
    const plan = buildDay(date, occupancy, batch, { sort: (xs) => adaptiveSort(xs, energy) });
    for (const b of plan.blocks.filter((x) => x.kind === 'task')) {
      await updateTask(b.taskId as string, { scheduledDate: date, scheduledStart: b.start });
    }
    whatNow = null;
    render();
  }

  // таймлайн: тап-выбор, перенос карточки по времени, drag из колонки

  let gesture: Gesture | null = null;      // активный жест (карточка или дело из колонки)

  function dragBubble(text: string | null): void {
    let el = document.querySelector<HTMLElement>('.drag-time');
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'drag-time';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  function rowAtPoint(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    return el?.closest<HTMLElement>('#tl-list .tl-row') || null;
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || editing || editPractice || pickAt !== null) return;
    const target = e.target as HTMLElement;

    const card = target.closest<HTMLElement>('.tl-card.task');
    if (card) {
      const block = state?.blocks.find((b) => b.taskId === card.dataset.task);
      if (!block) return;
      gesture = { type: 'move', id: block.taskId as string, startX: e.clientX, startY: e.clientY, startMin: block.start,
        durMin: block.end - block.start, moved: false, card };
    } else {
      const side = target.closest<HTMLElement>('.side-task');
      if (!side) return;
      const task = state?.unscheduled.find((x) => x.id === side.dataset.id);
      if (!task) return;
      gesture = { type: 'side', id: task.id, task, startY: e.clientY, startX: e.clientX, moved: false, ghost: null };
    }
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // события всё равно всплывут до root
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const g = gesture;
    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_PX) return;
    if (!g.moved) {
      g.moved = true;
      if (g.type === 'side') {
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = g.task.title;
        document.body.appendChild(ghost);
        g.ghost = ghost;
      }
    }
    if (g.type === 'move') {
      const delta = Math.round((e.clientY - g.startY) / DRAG_PX_PER_MIN);
      const ns = Math.max(0, Math.min(MINUTES - g.durMin, Math.round((g.startMin + delta) / 5) * 5));
      g.newStart = ns;
      g.card.style.transform = `translateY(${(ns - g.startMin) * DRAG_PX_PER_MIN}px)`;
      g.card.style.opacity = '.85';
      // курсор над колонкой дел — дело вернётся из расписания в дела
      const overSide = Boolean(document.elementFromPoint(e.clientX, e.clientY)?.closest('.side'));
      g.toSide = overSide;
      sideEl.classList.toggle('drop-col', overSide);
      dragBubble(overSide ? t('day.backToTasks') : `${minutesToTime(ns)}–${minutesToTime(ns + g.durMin)}`);
    } else {
      g.ghost!.style.left = `${e.clientX}px`;
      g.ghost!.style.top = `${e.clientY}px`;
      g.dropRow = rowAtPoint(e.clientX, e.clientY);
      document.querySelectorAll('#tl-list .tl-row').forEach((r) => r.classList.toggle('drop-row', r === g.dropRow));
    }
  });

  root.addEventListener('pointerup', async (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    if (!g.moved) return; // клик без движения — обычные обработчики
    // дальше жест: клик после отпускания погасит installClickGuard

    if (g.type === 'move') {
      g.card.style.transform = '';
      g.card.style.opacity = '';
      dragBubble(null);
      sideEl.classList.remove('drop-col');
      if (g.toSide) {
        // бросили в колонку дел — снять с расписания
        await updateTask(g.id, { scheduledDate: null, scheduledStart: null });
        whatNow = null;
      } else if (g.newStart !== undefined && g.newStart !== g.startMin) {
        await updateTask(g.id, { scheduledStart: g.newStart });
        whatNow = null;
      }
      render();
      return;
    }

    // дело из колонки бросили на строку дня — ставим на её время
    g.ghost?.remove();
    document.querySelectorAll('#tl-list .drop-row').forEach((r) => r.classList.remove('drop-row'));
    const row = rowAtPoint(e.clientX, e.clientY);
    const min = Number(row?.dataset.min ?? row?.dataset.start);
    if (row && !Number.isNaN(min)) {
      await updateTask(g.id, {
        scheduledDate: state!.date,
        scheduledStart: Math.min(Math.round(min / 5) * 5, MINUTES - g.task.durationMin),
      });
      whatNow = null;
    }
    render();
  });

  root.addEventListener('pointercancel', () => {
    if (!gesture) return;
    const g = gesture;
    if (g.type === 'move') {
      g.card.style.transform = '';
      g.card.style.opacity = '';
      dragBubble(null);
    }
    g.ghost?.remove();
    sideEl.classList.remove('drop-col');
    document.querySelectorAll('#tl-list .drop-row').forEach((r) => r.classList.remove('drop-row'));
    gesture = null;
  });

  scrollEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.tl-card');
    if (card) {
      if (card.classList.contains('routine')) {
        editPractice = card.dataset.practice ?? null;
      } else {
        editing = card.dataset.task ?? null;
      }
      pickerToTop();
      render();
      return;
    }
    const free = target.closest<HTMLElement>('.tl-free');
    if (free) {
      pickAt = Number(free.dataset.min);
      render();
    }
  });

  function pickerToTop(): void {
    root.closest<HTMLElement>('main')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  // обработчики

  root.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (handleRemindClick(root, e)) return;
    if (target.classList.contains('modal-overlay')) {
      editing = null;
      editPractice = null;
      pickAt = null;
      render();
      return;
    }

    if (target.closest('#pick-close')) {
      pickAt = null;
      render();
      return;
    }

    const pick = target.closest<HTMLElement>('.pick-task');
    if (pick && pickAt !== null) {
      await updateTask(pick.dataset.id as string, { scheduledDate: state!.date, scheduledStart: pickAt });
      pickAt = null;
      whatNow = null;
      render();
      return;
    }

    if (target.closest('#auto-place')) {
      await autoPlace();
      return;
    }

    const energyBtn = target.closest<HTMLElement>('[data-energy]');
    if (energyBtn) {
      energy = energyBtn.dataset.energy as Energy;
      saveEnergy(energy);
      whatNow = null;
      render();
      return;
    }

    if (target.closest('#what-now')) {
      skipIds.clear(); // ручной запрос — показываем всё заново
      const rec = recommendNow(state!.windows, state!.unscheduled, nowMinutes(), energy);
      whatNow = rec || 'empty';
      render();
      return;
    }

    if (target.closest('#whatnow-skip')) {
      // «Не это»: снять дело с рекомендации и показать следующее
      if (whatNow && whatNow !== 'empty') skipIds.add(whatNow.task.id);
      whatNow = null;
      const rec = recommendNow(state!.windows,
        state!.unscheduled.filter((x) => !skipIds.has(x.id)), nowMinutes(), energy);
      whatNow = rec || 'empty';
      render();
      return;
    }

    if (target.closest('#whatnow-close')) {
      whatNow = null;
      whatNowAuto = false; // закрыл подсказку — больше не показываем сами
      render();
      return;
    }

    // «Начать»: дело встаёт на сейчас и запускается обратный отсчёт —
    // время становится видимым, решение «сколько работать» снимается
    if (target.closest('#whatnow-start')) {
      const rec = whatNow;
      if (rec && rec !== 'empty' && state) {
        const now = Math.round(nowMinutes() / 5) * 5 % 1440;
        await updateTask(rec.task.id, { scheduledDate: state.date, scheduledStart: now });
        timer = { taskId: rec.task.id, end: Date.now() + rec.task.durationMin * 60000 };
        saveTimer();
        whatNow = null;
        whatNowAuto = false; // работаем над делом — следующие подсказки ни к чему
        render();
      }
      return;
    }

    if (target.closest('#timer-done')) {
      const btn = target.closest<HTMLElement>('#timer-done')!;
      const task = state?.allTasks.find((x) => x.id === btn.dataset.id);
      clearTimer();
      if (task) await completeTask(task);
      render();
      return;
    }

    if (target.closest('#timer-stop')) {
      // остановка без «провала»: дело остаётся в расписании, отсчёт снимается
      clearTimer();
      render();
      return;
    }

    // «+10 мин»: время докидывается, когда непонятно, сколько осталось работать
    if (target.closest('#timer-more')) {
      if (timer) {
        timer.end += 10 * 60000;
        saveTimer();
        const el = root.querySelector('#timer-left');
        if (el) el.textContent = fmtLeft(timer.end - Date.now());
      }
      return;
    }

    if (target.closest('#welcome-ok')) {
      try {
        localStorage.setItem(WELCOME_KEY, '1');
      } catch {
        // сохранение не критично
      }
      render();
      return;
    }

    if (target.closest('#routine-close')) {
      editPractice = null;
      render();
      return;
    }

    if (target.id === 'routine-save') {
      const title = root.querySelector<HTMLInputElement>('#r-title')!.value.trim();
      const days = [...root.querySelectorAll<HTMLInputElement>('.days input:checked')].map((c) => Number(c.dataset.day));
      if (!title || !days.length) return;
      const old = state!.practices.find((p) => p.id === target.dataset.id);
      const card = target.closest<HTMLElement>('.card')!;
      await savePractice(new Practice({
        id: target.dataset.id || crypto.randomUUID(),
        sphereId: old?.sphereId ?? null,
        title,
        days,
        start: timeToMinutes(normalizeTimeValue(card.querySelector<HTMLInputElement>('.js-start')!.value) || '23:00'),
        end: timeToMinutes(normalizeTimeValue(card.querySelector<HTMLInputElement>('.js-end')!.value) || '07:00'),
      }));
      editPractice = null;
      render();
      return;
    }

    if (target.id === 'routine-delete') {
      await deletePractice(target.dataset.id as string);
      editPractice = null;
      render();
      return;
    }

    const place = target.closest<HTMLElement>('#whatnow-place');
    if (place) {
      await updateTask(place.dataset.id as string, { scheduledDate: state!.date, scheduledStart: Number(place.dataset.start) });
      whatNow = null;
      render();
      return;
    }

    if (target.closest('#overdue-return')) {
      const overdue = state!.allTasks.filter((x) => x.status === 'todo' && x.scheduledDate && x.scheduledDate < state!.date);
      for (const x of overdue) {
        await updateTask(x.id, { scheduledDate: null, scheduledStart: null });
      }
      render();
      return;
    }

    if (target.closest('#quick-save')) {
      await quickAdd();
      return;
    }

    // пример в пустой колонке: подставить текст в быстрый ввод и создать
    const emptyPreset = target.closest<HTMLElement>('[data-empty-preset]');
    if (emptyPreset) {
      const input = root.querySelector<HTMLInputElement>('#quick-add');
      if (input) {
        input.value = t(emptyPreset.dataset.emptyPreset!);
        await quickAdd();
      }
      return;
    }

    if (target.closest('#edit-close')) {
      editing = null;
      render();
      return;
    }

    if (target.id === 'e-save') {
      const x = state!.allTasks.find((y) => y.id === target.dataset.id)!;
      const repeatKind = root.querySelector<HTMLSelectElement>('#e-repeat')!.value;
      const repeatN = Number(root.querySelector<HTMLInputElement>('#e-repeat-n')?.value) || 3;
      const patch: TaskPatch = {
        title: root.querySelector<HTMLInputElement>('#e-title')!.value.trim(),
        durationMin: Number(root.querySelector<HTMLInputElement>('#e-dur')!.value) || 30,
        group: root.querySelector<HTMLSelectElement>('#e-group')!.value,
        sphereId: root.querySelector<HTMLSelectElement>('#e-sphere')!.value || null,
        dueAt: readRemindInput(root, 'e'),
        repeatRule: repeatKind === 'every' ? `every:${repeatN}` : (repeatKind || null),
      };
      if (!patch.title) return;
      // ручное время начала: указано — поставить на сегодня; «—» — снять
      const startVal = normalizeTimeValue(root.querySelector<HTMLInputElement>('.js-estart')?.value);
      if (startVal) {
        patch.scheduledDate = state!.date;
        patch.scheduledStart = timeToMinutes(startVal);
      } else if (x.scheduledDate === state!.date) {
        patch.scheduledDate = null;
        patch.scheduledStart = null;
      }
      // длительность может перестать влезать в окно — место сохраняется:
      // перекрытие остаётся осознанным решением пользователя
      await updateTask(x.id, patch);
      editing = null;
      render();
      return;
    }

    if (target.id === 'e-tomorrow') {
      const x = state!.allTasks.find((y) => y.id === target.dataset.id);
      if (x) await updateTask(x.id, { scheduledDate: addDays(state!.date, 1) });
      editing = null;
      render();
      return;
    }

    if (target.id === 'e-breakdown') {
      const x = state!.allTasks.find((y) => y.id === target.dataset.id);
      if (!x) return;
      const msg = root.querySelector<HTMLElement>('#e-msg');
      if (msg) msg.textContent = '…';
      const steps = await breakdownWithLlm(x.title);
      if (!steps) {
        if (msg) msg.textContent = t('task.breakdownFailed');
        return;
      }
      const stepDur = Math.min(30, Math.max(10, Math.round(x.durationMin / steps.length / 5) * 5));
      for (const step of steps) {
        await saveTask(new Task({
          id: crypto.randomUUID(),
          title: step,
          group: x.group,
          sphereId: x.sphereId,
          durationMin: stepDur,
          status: 'todo',
          source: 'llm',
        }));
      }
      await deleteTask(x.id);
      editing = null;
      render();
      const quickMsg = root.querySelector<HTMLElement>('#quick-msg');
      if (quickMsg) quickMsg.textContent = t('task.brokenInto', { n: steps.length });
      return;
    }

    if (target.id === 'e-delete') {
      await deleteTask(target.dataset.id as string);
      editing = null;
      render();
      return;
    }

    const editBtn = target.closest<HTMLElement>('.edit-btn');
    if (editBtn) {
      editing = editBtn.dataset.id as string;
      pickerToTop();
      render();
      return;
    }

    const doneBtn = target.closest<HTMLElement>('.done-btn');
    if (doneBtn) {
      const task = state!.allTasks.find((x) => x.id === doneBtn.dataset.id);
      if (task) await completeTask(task);
      render();
      return;
    }

    const doneItem = target.closest<HTMLElement>('.done-item');
    if (doneItem) {
      await updateTask(doneItem.dataset.id as string, { status: 'todo' });
      render();
      return;
    }

    const side = target.closest<HTMLElement>('.side-task');
    if (side) {
      const task = state!.unscheduled.find((x) => x.id === side.dataset.id);
      if (!task) return;
      // ставим в первое подходящее окно после текущего момента (не в 00:00
      // посреди дня); если таких нет — в первое вообще, с перекрытием
      const nowR = Math.ceil(nowMinutes() / 15) * 15;
      const fits = (x: FreeWindow) => x.end - x.start >= task.durationMin;
      const w = state!.windows.find((x) => fits(x) && x.end > nowR) || state!.windows.find(fits) || state!.windows[0];
      if (w) {
        const start = nowR >= w.start && nowR + task.durationMin <= w.end ? nowR : w.start;
        await updateTask(task.id, { scheduledDate: state!.date, scheduledStart: start });
        whatNow = null;
        render();
      }
      return;
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    if (el.id === 'e-repeat') {
      const wrap = root.querySelector<HTMLElement>('#e-repeat-n-wrap');
      if (wrap) wrap.hidden = (el as HTMLSelectElement).value !== 'every';
    }
    // группа наследуется от направления — выбирать вручную не нужно
    if (el.id === 'e-sphere' && (el as HTMLSelectElement).value) {
      const sphere = state!.spheres.find((s) => s.id === (el as HTMLSelectElement).value);
      const group = root.querySelector<HTMLSelectElement>('#e-group');
      if (sphere && group) group.value = sphere.group;
    }
  });

  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id === 'quick-add' && e.key === 'Enter') quickAdd();
  });

  // быстрый ввод с экрана дня: тот же гибридный разбор, дело создаётся сразу
  async function quickAdd(): Promise<void> {
    const input = root.querySelector<HTMLInputElement>('#quick-add')!;
    const msg = root.querySelector<HTMLElement>('#quick-msg');
    const text = input.value.trim();
    if (!text) return;

    const parsed = await categorize(text);
    if (parsed.kind !== 'task') {
      if (msg) msg.textContent = parsed.kind === 'routine' ? t('day.quickRoutineHint') : t('day.quickSphereHint');
      return;
    }
    await saveParsedTask(text, parsed);
    input.value = '';
    if (msg) msg.textContent = '';
    render();
  }

  document.addEventListener('tab-shown', (e) => {
    if ((e as CustomEvent).detail === 'day') render();
  });

  render();
}
