// вспомогательные функции для расписания: время и дни недели

import { t } from './i18n.js';
import type { Practice } from './models.js';

// названия дней — из словаря локализации (см. i18n.js), ключи 0..6
export function dayNames(): string[] {
  return t('dayNames') as unknown as string[];
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// проходит ли практика в указанный день недели (1..7, 1 = понедельник)
export function practiceAppliesOn(practice: Practice, dayOfWeek: number): boolean {
  return practice.days.includes(dayOfWeek);
}

export function formatDays(days: number[]): string {
  if (days.length === 7) return t('schedule.daily');
  const names = dayNames();
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => names[d - 1])
    .join(', ');
}

// timestamp -> значение поля datetime-local ('YYYY-MM-DDTHH:mm', локальное время)
export function tsToLocalInput(ts: number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// значение datetime-local -> timestamp; пустая строка -> null
export function localInputToTs(val: string): number | null {
  return val ? new Date(val).getTime() : null;
}

// сегодняшняя дата 'YYYY-MM-DD' в локальном времени
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' + n дней -> 'YYYY-MM-DD' (локально, без таймзонных сдвигов)
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// день недели даты 'YYYY-MM-DD': 1 = понедельник .. 7 = воскресенье
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
}

// сетка месяца для календаря: 42 даты 'YYYY-MM-DD' (6 недель), неделя с
// понедельника; в начале и конце — хвосты соседних месяцев. month — 0..11.
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const out: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}
