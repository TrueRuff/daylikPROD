// Тесты сборки событий месяца: рутины по дням недели, полночные,
// группировка дел, события «весь день».

import { describe, it, expect } from 'vitest';
import { eventsForRange, allDayEvents, toDateStr, GROUP_COLORS } from '../src/core/calendarEvents';
import { Practice, Task } from '../src/core/models';

const task = (id, over = {}) => new Task({ id, title: `Дело ${id}`, group: 'Н', durationMin: 30, ...over });

describe('eventsForRange', () => {
  it('рутина попадает только в свои дни недели', () => {
    const p = new Practice({ id: 'p1', title: 'Учёба', days: [1], start: 540, end: 600 }); // только пн
    // 2026-10-25 — воскресенье, 2026-10-26 — понедельник
    const evts = eventsForRange('2026-10-25', '2026-10-26', [p], []);
    expect(evts).toHaveLength(1);
    expect(evts[0].extendedProps).toMatchObject({ kind: 'routine', practiceId: 'p1' });
    expect(toDateStr(evts[0].start)).toBe('2026-10-26');
  });

  it('рутина через полночь разбивается на два события в пределах дня', () => {
    const p = new Practice({ id: 'p2', title: 'Сон', days: [1, 2, 3, 4, 5, 6, 7], start: 1380, end: 420 });
    const evts = eventsForRange('2026-10-26', '2026-10-26', [p], []);
    expect(evts).toHaveLength(2);
    expect(evts.map((e) => e.start.getHours())).toEqual([23, 0]);
    expect(evts[0].end.getDate()).toBe(27); // конец полуночного блока — 00:00 следующих суток
  });

  it('запланированное дело даёт событие с временем, цветом группы и taskId', () => {
    const x = task('t1', { group: 'Ж', scheduledDate: '2026-10-26', scheduledStart: 600, durationMin: 45 });
    const [ev] = eventsForRange('2026-10-26', '2026-10-26', [], [x]);
    expect(ev.title).toBe('Ж · Дело t1');
    expect(ev.backgroundColor).toBe(GROUP_COLORS['Ж']);
    expect(ev.start.getHours()).toBe(10);
    expect((ev.end - ev.start) / 60000).toBe(45);
    expect(ev.editable).toBe(true);
    expect(ev.extendedProps.taskId).toBe('t1');
  });

  it('дело с датой без времени не попадает в timed-события', () => {
    const x = task('t2', { scheduledDate: '2026-10-26', scheduledStart: null });
    expect(eventsForRange('2026-10-26', '2026-10-26', [], [x])).toHaveLength(0);
  });

  it('диапазон месяца собирает рутины по каждому применимому дню', () => {
    const p = new Practice({ id: 'p3', title: 'Зарядка', days: [1, 2, 3, 4, 5], start: 420, end: 440 });
    const evts = eventsForRange('2026-10-01', '2026-10-31', [p], []);
    expect(evts).toHaveLength(22); // октябрь 2026: 22 будних дня
  });

  it('битые даты диапазона — пустой список, а не зависание', () => {
    expect(eventsForRange('мусор', '2026-10-26', [], [])).toEqual([]);
    expect(eventsForRange('2026-10-26', 'не дата', [], [])).toEqual([]);
    expect(eventsForRange('2026-11-01', '2026-10-01', [], [])).toEqual([]); // перевёрнутый
  });
});

describe('allDayEvents', () => {
  it('дело с датой без времени — событие «весь день» в границах диапазона', () => {
    const a = task('a', { scheduledDate: '2026-10-05', scheduledStart: null });
    const b = task('b', { scheduledDate: '2026-11-01', scheduledStart: null }); // вне диапазона
    const evts = allDayEvents('2026-10-01', '2026-10-31', [a, b]);
    expect(evts).toHaveLength(1);
    expect(evts[0].allDay).toBe(true);
    expect(evts[0].extendedProps.taskId).toBe('a');
  });
});

describe('toDateStr', () => {
  it('локальная дата без UTC-сдвига', () => {
    expect(toDateStr(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
});
