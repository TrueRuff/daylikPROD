import { describe, it, expect } from 'vitest';
import { timeToMinutes, minutesToTime, practiceAppliesOn, formatDays, tsToLocalInput, localInputToTs, monthGrid } from '../src/core/schedule';

describe('schedule', () => {
  it('время в минуты и обратно', () => {
    expect(timeToMinutes('23:00')).toBe(1380);
    expect(timeToMinutes('00:45')).toBe(45);
    expect(minutesToTime(1380)).toBe('23:00');
    expect(minutesToTime(45)).toBe('00:45');
  });

  it('практика применяется по дням недели', () => {
    const p = { days: [1, 3, 5] }; // пн, ср, пт
    expect(practiceAppliesOn(p, 3)).toBe(true);
    expect(practiceAppliesOn(p, 6)).toBe(false);
  });

  it('формат дней: ежедневно или списком', () => {
    expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBe('ежедневно');
    expect(formatDays([5, 1])).toBe('пн, пт');
  });

  it('timestamp и datetime-local переводятся туда-обратно', () => {
    const ts = new Date(2026, 9, 24, 14, 30).getTime();
    expect(tsToLocalInput(ts)).toBe('2026-10-24T14:30');
    expect(localInputToTs('2026-10-24T14:30')).toBe(ts);
  });

  it('пустое напоминание -> null, без timestamp -> пустая строка', () => {
    expect(localInputToTs('')).toBeNull();
    expect(tsToLocalInput(null)).toBe('');
  });

  it('сетка месяца: 42 даты с понедельника, с хвостами соседних месяцев', () => {
    const grid = monthGrid(2026, 9); // октябрь 2026, 1-е — четверг
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-28'); // понедельник перед 1 октября
    expect(grid[3]).toBe('2026-10-01');
    expect(grid[41]).toBe('2026-11-08');
    expect(new Set(grid).size).toBe(42);
  });

  it('сетка месяца не сбивается на границе года', () => {
    const grid = monthGrid(2027, 0); // январь 2027, 1-е — пятница
    expect(grid[0]).toBe('2026-12-28');
    expect(grid[4]).toBe('2027-01-01');
    expect(grid[41]).toBe('2027-02-07');
  });
});
