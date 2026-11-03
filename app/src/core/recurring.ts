// повторяющиеся дела: расчёт следующего вхождения по repeatRule.
// repeatRule: null | 'daily' | 'weekly' | 'every:N' (каждые N дней).

import { addDays, todayStr } from './schedule.js';
import type { Task } from './models.js';

const EVERY_RE = /^every:(\d+)$/;

// следующая дата 'YYYY-MM-DD' для повтора от базовой даты
export function nextDate(repeatRule: string, fromDate: string): string | null {
  const daily = EVERY_RE.exec(repeatRule);
  if (repeatRule === 'daily') return addDays(fromDate, 1);
  if (repeatRule === 'weekly') return addDays(fromDate, 7);
  if (daily && Number(daily[1]) > 0) return addDays(fromDate, Number(daily[1]));
  return null; // не повторяется или неизвестный формат
}

export function isRepeatRule(v: unknown): boolean {
  return v === null || v === 'daily' || v === 'weekly' || (typeof v === 'string' && EVERY_RE.test(v));
}

// патч для новой задачи-вхождения после завершения текущей
export interface OccurrencePatch {
  scheduledDate: string | null;
  scheduledStart: number | null;
}

// следующее вхождение после завершения: патч для новой задачи
// или null, если дело не повторяется
export function nextOccurrence(task: Task): OccurrencePatch | null {
  if (!task.repeatRule || !isRepeatRule(task.repeatRule)) return null;
  const base = task.scheduledDate || null;
  const date = nextDate(task.repeatRule, base || todayStr());
  if (!date) return null;
  return {
    scheduledDate: task.scheduledDate != null ? date : null, // встречу в расписании переносим, свободную оставляем свободной
    scheduledStart: task.scheduledStart,
  };
}
