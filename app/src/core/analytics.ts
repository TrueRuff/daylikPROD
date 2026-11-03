// аналитика дня: сводка по плану/факту/свободному времени поверх готовых алгоритмов.

import { computeFreeWindows, practicesToBlocks } from './dayPlan.js';
import { practiceAppliesOn, weekdayOf } from './schedule.js';
import { t } from './i18n.js';
import type { Practice, Task } from './models.js';

const h = (min: number) => `${Math.floor(min / 60)}ч ${String(min % 60).padStart(2, '0')}м`;

export interface DayStats {
  plannedMin: number;
  doneMin: number;
  doneCount: number;
  freeMin: number;
  overloadMin: number;
  summary: string;
}

// сводка дня: план/сделано/свободно по длительностям + перегруз
export function dayStats(date: string, todo: Task[], done: Task[], practices: Practice[]): DayStats {
  const wd = weekdayOf(date);
  const routines = practicesToBlocks(practices.filter((p) => practiceAppliesOn(p, wd)));

  const scheduled = todo.filter((x) => x.scheduledDate === date && x.scheduledStart != null);
  const blocks = [
    ...routines,
    ...scheduled.map((x) => ({ start: x.scheduledStart as number, end: (x.scheduledStart as number) + x.durationMin })),
  ];
  const freeMin = computeFreeWindows(blocks).reduce((s, w) => s + (w.end - w.start), 0);

  const plannedMin = scheduled.reduce((s, x) => s + x.durationMin, 0);
  const doneMin = done.reduce((s, x) => s + x.durationMin, 0);
  // перегруз — только сегодняшняя гора: бездатные и «сегодня без времени»;
  // отложенные на завтра и хвосты прошлых дней сюда не входят
  const today = todo.filter((x) => !x.scheduledDate || (x.scheduledDate === date && x.scheduledStart == null));
  const remainingMin = today.reduce((s, x) => s + x.durationMin, 0);
  const overloadMin = Math.max(0, remainingMin - freeMin);

  return {
    plannedMin,
    doneMin,
    doneCount: done.length,
    freeMin,
    overloadMin,
    summary: `${plannedMin ? `${t('stats.plan')} ${h(plannedMin)} · ` : ''}${t('stats.done')} ${h(doneMin)} · ${t('stats.free')} ${h(freeMin)}`,
  };
}

// сколько дел направления закрыто за последние days дней (стрики не считаем —
// только объём за неделю; дела без направления и без doneAt пропускаются)
export function doneInLastDays(tasks: Task[], days = 7): Map<string, number> {
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  for (const x of tasks) {
    if (x.status !== 'done' || x.doneAt == null || !x.sphereId) continue;
    if (x.doneAt < from || x.doneAt > now) continue;
    counts.set(x.sphereId, (counts.get(x.sphereId) || 0) + 1);
  }
  return counts;
}
