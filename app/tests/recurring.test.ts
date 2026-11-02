import { describe, it, expect } from 'vitest';
import { nextDate, nextOccurrence, isRepeatRule } from '../src/core/recurring';
import { Task } from '../src/core/models';

describe('nextDate', () => {
  it('daily/weekly/every:N сдвигают дату на нужное число дней', () => {
    expect(nextDate('daily', '2026-10-24')).toBe('2026-10-25');
    expect(nextDate('weekly', '2026-10-24')).toBe('2026-10-31');
    expect(nextDate('every:3', '2026-10-24')).toBe('2026-10-27');
  });

  it('переход через месяц и февраль', () => {
    expect(nextDate('daily', '2026-01-31')).toBe('2026-02-01');
    expect(nextDate('weekly', '2026-02-22')).toBe('2026-03-01');
  });

  it('null и мусор дают null', () => {
    expect(nextDate(null, '2026-10-24')).toBeNull();
    expect(nextDate('иногда', '2026-10-24')).toBeNull();
    expect(nextDate('every:0', '2026-10-24')).toBeNull();
  });
});

describe('isRepeatRule', () => {
  it('допускает null, daily, weekly и every:N', () => {
    expect(isRepeatRule(null)).toBe(true);
    expect(isRepeatRule('daily')).toBe(true);
    expect(isRepeatRule('weekly')).toBe(true);
    expect(isRepeatRule('every:14')).toBe(true);
    expect(isRepeatRule('каждый день')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  const task = (over) => new Task({ id: 't1', title: 'Полить цветы', group: 'Н', durationMin: 15, ...over });

  it('запланированное ежедневное дело переносится на завтра с тем же временем', () => {
    const patch = nextOccurrence(task({ repeatRule: 'daily', scheduledDate: '2026-10-24', scheduledStart: 600 }));
    expect(patch).toEqual({ scheduledDate: '2026-10-25', scheduledStart: 600 });
  });

  it('свободное дело остаётся свободным, но дата считается от сегодня', () => {
    const patch = nextOccurrence(task({ repeatRule: 'weekly' }));
    expect(patch.scheduledDate).toBeNull();
    expect(patch.scheduledStart).toBeNull();
  });

  it('без правила — null', () => {
    expect(nextOccurrence(task({}))).toBeNull();
    expect(nextOccurrence(task({ repeatRule: 'мусор' }))).toBeNull();
  });
});
