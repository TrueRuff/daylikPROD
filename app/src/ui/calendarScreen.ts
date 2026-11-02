// экран «Календарь»: месяц сеткой отдельных карточек дней (не таблица).
// Точки показывают загруженность, наведение — что именно запланировано,
// клик по дню открывает модалку со списком рутин и дел. Расстановка — на «Дне».

import { getPractices, getTasks } from '../core/storage.js';
import { eventsForRange, allDayEvents, toDateStr, GROUP_COLORS, ROUTINE_COLOR } from '../core/calendarEvents.js';
import type { CalEvent } from '../core/calendarEvents.js';
import { practiceAppliesOn, weekdayOf, minutesToTime, monthGrid, todayStr } from '../core/schedule.js';
import { getLang, t, onChange } from '../core/i18n.js';
import { escapeHtml } from './dom.js';
import type { Practice, Task } from '../core/models.js';

const MAX_DOTS = 3;

const CHEV_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
const CHEV_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>';

interface DayRecord {
  events: CalEvent[];
  routines: Practice[];
  tasks: Task[];
}

export function initCalendarScreen(root: HTMLElement): void {
  let dirty = true; // данные меняются на других экранах — обновимся при показе
  let gen = 0;      // устаревшая параллельная отрисовка не трогает DOM
  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth(), 1); // первый день месяца
  let state = { byDate: new Map<string, DayRecord>() };

  const locale = () => (getLang() === 'en' ? 'en-GB' : 'ru-RU');

  function monthLabel(date: Date): string {
    const raw = date.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function dayLabel(dateStr: string): string {
    return new Date(`${dateStr}T00:00`).toLocaleDateString(locale(),
      { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function dayModalHtml(dateStr: string): string {
    const { routines = [], tasks = [] } = state.byDate.get(dateStr) || {};
    const rows = [
      ...routines
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((p) => `
        <div class="tl-row">
          <div class="tl-t">${minutesToTime(p.start)}</div>
          <div class="tl-card routine"><span class="tl-title">↻ ${escapeHtml(p.title)}</span></div>
        </div>`),
      ...tasks
        .slice()
        .sort((a, b) => (a.scheduledStart ?? -1) - (b.scheduledStart ?? -1))
        .map((x) => `
        <div class="tl-row">
          <div class="tl-t">${x.scheduledStart != null ? minutesToTime(x.scheduledStart) : '—'}</div>
          <div class="tl-card task" style="background:${GROUP_COLORS[x.group] ?? 'var(--accent)'}">
            <span class="tl-title">${escapeHtml(x.title)}</span>
            ${x.durationMin ? `<span class="tl-dur">${x.durationMin} ${t('task.minutes')}</span>` : ''}
          </div>
        </div>`),
    ];
    return `
      <div class="modal-overlay">
        <div class="modal-card">
          <div class="row between modal-head">
            <strong>${dayLabel(dateStr)}</strong>
            <button id="cal-modal-close" class="icon-btn" title="${t('common.close')}">✕</button>
          </div>
          ${rows.length ? `<div class="tl-list">${rows.join('')}</div>` : `<p class="muted">${t('cal.empty')}</p>`}
        </div>
      </div>`;
  }

  // одна карточка дня: число, точки задач (цвет группы) и рутин (серые),
  // хвост месяца приглушён, сегодня — акцентная обводка
  function dayCellHtml(date: string, today: string): string {
    const rec = state.byDate.get(date) || { events: [], routines: [], tasks: [] };
    const [y, m, d] = date.split('-').map(Number);
    const out = y !== cursor.getFullYear() || m - 1 !== cursor.getMonth();
    const isToday = date === today;

    // задачи — первыми: их цвет группы важнее серых рутин
    const events = [...rec.events].sort((a, b) =>
      (a.extendedProps?.kind === 'task' ? 0 : 1) - (b.extendedProps?.kind === 'task' ? 0 : 1));
    const names = [...rec.tasks.map((x) => x.title), ...rec.routines.map((p) => p.title)];
    const shown = events.slice(0, MAX_DOTS);
    const rest = events.length - shown.length;
    const dots = shown
      .map((e) => `<span class="cal-dot" style="background:${e.backgroundColor ?? ROUTINE_COLOR}"></span>`)
      .join('')
      + (rest ? `<span class="cal-more">+${rest}</span>` : '');

    const tip = names.length
      ? `${dayLabel(date)}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`
      : `${dayLabel(date)} — ${t('cal.empty')}`;

    return `
      <button class="cal-day${out ? ' out' : ''}${isToday ? ' today' : ''}"
        data-date="${date}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(dayLabel(date))}"
        ${isToday ? 'aria-current="date"' : ''}>
        <span class="cal-num">${d}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
  }

  async function render(): Promise<void> {
    const g = ++gen;
    const [practices, todo] = await Promise.all([getPractices(), getTasks({ status: 'todo' })]);
    if (g !== gen) return;

    const dates = monthGrid(cursor.getFullYear(), cursor.getMonth());
    const from = dates[0];
    const to = dates[dates.length - 1];
    // тот же поток событий, что рисовал прежний календарь: рутины по дням
    // недели и дела; хвосты соседних месяцев входят в диапазон
    const events = [...eventsForRange(from, to, practices, todo), ...allDayEvents(from, to, todo)];
    const byDate = new Map<string, DayRecord>(dates.map((date) => [date, { events: [], routines: [], tasks: [] }]));
    for (const ev of events) {
      const rec = byDate.get(toDateStr(ev.start));
      if (rec) rec.events.push(ev);
    }
    for (const date of dates) {
      const rec = byDate.get(date)!;
      const wd = weekdayOf(date);
      rec.routines = practices.filter((p) => practiceAppliesOn(p, wd));
      rec.tasks = todo.filter((x) => x.scheduledDate === date);
    }
    state = { byDate };

    const today = todayStr();
    const cells = dates.map((date) => dayCellHtml(date, today)).join('');
    const weekdays = (t('dayNames') as unknown as string[]).map((d) => `<span>${d}</span>`).join('');

    root.innerHTML = `
      <div class="cal-bar">
        <button id="cal-prev" class="icon-btn cal-nav" title="${t('cal.prev')}">${CHEV_LEFT}</button>
        <h2 class="cal-title">${monthLabel(cursor)}</h2>
        <button id="cal-next" class="icon-btn cal-nav" title="${t('cal.next')}">${CHEV_RIGHT}</button>
      </div>
      <div class="cal-shell">
        <div class="cal-week" aria-hidden="true">${weekdays}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-foot">
          <button id="cal-today" class="secondary">${t('cal.today')}</button>
        </div>
      </div>
      <div id="cal-modal"></div>`;
  }

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#cal-prev') || target.closest('#cal-next')) {
      const step = target.closest('#cal-prev') ? -1 : 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
      render();
      return;
    }
    if (target.closest('#cal-today')) {
      const t0 = new Date();
      cursor = new Date(t0.getFullYear(), t0.getMonth(), 1);
      render();
      return;
    }

    const modal = root.querySelector<HTMLElement>('#cal-modal')!;
    if (target.classList.contains('modal-overlay') || target.closest('#cal-modal-close')) {
      modal.innerHTML = '';
      return;
    }
    const day = target.closest<HTMLElement>('.cal-day');
    if (day?.dataset.date) modal.innerHTML = dayModalHtml(day.dataset.date);
  });

  // смена языка перерисовывает подписи и месяц
  onChange(render);

  document.addEventListener('tab-shown', (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail === 'day' || detail === 'spheres') dirty = true;
    if (detail === 'calendar' && dirty) {
      dirty = false;
      render();
    }
  });

  render();
}
