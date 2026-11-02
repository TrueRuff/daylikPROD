// события календаря: рутины и запланированные дела, разворачиваемые по датам
// диапазона (месяц на экране «Календарь»). Чистые функции без DOM —
// покрываются юнит-тестами.

import { practiceAppliesOn, addDays, weekdayOf } from './schedule.js';
import { practicesToBlocks } from './dayPlan.js';
import type { PlanBlock, Practice, SphereGroup, Task } from './models.js';

// цвета как в дизайн-системе (styles.css): Н терракота, Ж янтарь, П синий
export const GROUP_COLORS: Record<SphereGroup, string> = { 'Н': '#a94e35', 'Ж': '#8a6410', 'П': '#40628a' };
export const ROUTINE_COLOR = '#6f7581';

export type CalEventKind = 'routine' | 'task';

// событие в формате, совместимом с FullCalendar
export interface CalEvent {
  id: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay?: boolean;
  backgroundColor: string;
  editable: boolean;
  extendedProps: { kind: CalEventKind; practiceId?: string; taskId?: string };
}

// date -> 'YYYY-MM-DD' в локальной зоне (без UTC-сдвига)
export function toDateStr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDate(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

// диапазон дат [from, to] включительно; рутины фильтруются по дню недели,
// полночные разбиваются practicesToBlocks; дела берутся с датой и временем.
// дела с датой без времени — события «весь день» (видны в месяце).
// битые даты или перевёрнутый диапазон — пустой список, иначе addDays
// зациклится на 'Invalid Date'
export function eventsForRange(fromDate: string, toDate: string, practices: Practice[], tasks: Task[]): CalEvent[] {
  const ok = (d: string) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(fromDate) || !ok(toDate) || fromDate > toDate) return [];
  const events: CalEvent[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const ofToday = practices.filter((p) => practiceAppliesOn(p, weekdayOf(date)));
    for (const b of practicesToBlocks(ofToday)) {
      events.push({
        id: `p:${b.id}:${date}:${b.start}`,
        title: b.label as string,
        start: localDate(date, b.start),
        end: localDate(date, b.end),
        backgroundColor: ROUTINE_COLOR,
        editable: false,
        extendedProps: { kind: 'routine', practiceId: b.id },
      });
    }
    for (const task of tasks) {
      if (task.scheduledDate !== date || task.scheduledStart == null) continue;
      events.push(taskEvent(task, date));
    }
  }
  return events;
}

export function taskEvent(task: Task, date: string = task.scheduledDate as string): CalEvent {
  const timed = task.scheduledStart != null;
  return {
    id: `t:${task.id}`,
    title: `${task.group} · ${task.title}`,
    start: timed ? localDate(date, task.scheduledStart as number) : localDate(date, 0),
    end: timed ? localDate(date, (task.scheduledStart as number) + task.durationMin) : null,
    allDay: !timed,
    backgroundColor: GROUP_COLORS[task.group] ?? ROUTINE_COLOR,
    editable: timed,
    extendedProps: { kind: 'task', taskId: task.id },
  };
}

// события «весь день» (дата без времени) в границах диапазона — для месяца
export function allDayEvents(fromDate: string, toDate: string, tasks: Task[]): CalEvent[] {
  return tasks
    .filter((x) => x.scheduledDate && x.scheduledStart == null
      && x.scheduledDate >= fromDate && x.scheduledDate <= toDate)
    .map((x) => taskEvent(x));
}
