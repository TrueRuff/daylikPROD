import { describe, it, expect } from 'vitest';
import { toIcs } from '../src/core/ics';
import { Task } from '../src/core/models';

const task = (id, over = {}) =>
  new Task({ id, title: `Дело ${id}`, group: 'Н', durationMin: 90, ...over });

describe('toIcs', () => {
  it('запланированное дело становится событием с началом, концом и сводкой', () => {
    const ics = toIcs([task('t1', { scheduledDate: '2026-10-24', scheduledStart: 600 })], { stamp: '20261024T080000' });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:t1@daylik');
    expect(ics).toContain('DTSTART:20261024T100000'); // 600 мин = 10:00
    expect(ics).toContain('DTEND:20261024T113000');   // +90 минут
    expect(ics).toContain('SUMMARY:Дело t1');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('дело без даты пропускается', () => {
    const ics = toIcs([task('t1'), task('t2', { scheduledDate: '2026-10-25', scheduledStart: 0 })]);
    expect(ics).not.toContain('UID:t1@daylik');
    expect(ics).toContain('UID:t2@daylik');
    expect(ics).toContain('DTSTART:20261025T000000');
  });

  it('спецсимволы экранируются, строки через CRLF', () => {
    const ics = toIcs([task('t1', { scheduledDate: '2026-10-24', scheduledStart: 0, title: 'Встреча; с, коллегами' })]);
    expect(ics).toContain('SUMMARY:Встреча\\; с\\, коллегами');
    expect(ics).toContain('\r\n');
  });

  it('пустой список — только каркас календаря', () => {
    const ics = toIcs([]);
    expect(ics).not.toContain('VEVENT');
    expect(ics).toContain('PRODID:-//Daylik//Planner//RU');
  });
});

describe('toIcs — краевые случаи', () => {
  it('дело через полночь даёт DTEND на следующий день', async () => {
    const { toIcs } = await import('../src/core/ics');
    const ics = toIcs([
      { id: 't1', title: 'Ночной разбор', group: 'Н', scheduledDate: '2026-10-28', scheduledStart: 1380, durationMin: 120 },
    ], { stamp: '20261028T000000' });
    expect(ics).toContain('DTSTART:20261028T230000');
    expect(ics).toContain('DTEND:20261029T010000');
  });

  it('перевод строки и возврат каретки в названии экранируются', async () => {
    const { toIcs } = await import('../src/core/ics');
    const title = 'строка' + String.fromCharCode(10) + 'вторая' + String.fromCharCode(13) + 'конец';
    const ics = toIcs([
      { id: 't1', title, group: 'Н', scheduledDate: '2026-10-28', scheduledStart: 600, durationMin: 30 },
    ], { stamp: '20261028T000000' });
    const summary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
    expect(summary).toBe('SUMMARY:строка\\nвторая\\rконец');
  });
});
