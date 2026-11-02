// экспорт дел в формат календаря iCalendar (.ics): запланированные дела
// становятся событиями с началом и длительностью. RFC 5545: строки через CRLF,
// спецсимволы экранируются, даты в базовом формате YYYYMMDDTHHMMSS.

import { addDays } from './schedule.js';
import type { Task } from './models.js';

// дата+минуты -> 'YYYYMMDDTHHMMSS'; минуты за полночь переносятся на следующий день
function icsDate(dateStr: string, minutes: number): string {
  const dayShift = Math.floor(minutes / 1440);
  const rest = minutes - dayShift * 1440;
  const base = dayShift ? addDays(dateStr, dayShift) : dateStr;
  const [y, m, d] = base.split('-');
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}00`;
}

function esc(s: unknown): string {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

// folding: строки длиннее 75 октетов продолжаются с пробелом
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest) parts.push(rest);
  return parts.join('\r\n ');
}

export interface IcsOptions {
  stamp?: string; // строка DTSTAMP 'YYYYMMDDTHHMMSS'
}

/**
 * @param tasks дела с scheduledDate (другие пропускаются)
 */
export function toIcs(tasks: Task[], opts: IcsOptions = {}): string {
  const stamp = opts.stamp || icsDate('2026-01-01', 0);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daylik//Planner//RU',
    'CALSCALE:GREGORIAN',
  ];
  for (const t of tasks) {
    if (!t.scheduledDate) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(t.id)}@daylik`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(t.scheduledDate, t.scheduledStart || 0)}`,
      `DTEND:${icsDate(t.scheduledDate, (t.scheduledStart || 0) + t.durationMin)}`,
      fold(`SUMMARY:${esc(t.title)}`),
      `DESCRIPTION:${esc(`Дейлик · группа ${t.group}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
