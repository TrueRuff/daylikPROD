import { describe, it, expect } from 'vitest';
import { dayStats, doneInLastDays } from '../src/core/analytics';
import { Task, Practice } from '../src/core/models';

// 2026-10-24 — суббота (день недели 6)
const DATE = '2026-10-24';

const task = (id, over = {}) =>
  new Task({ id, title: `дело ${id}`, group: 'Н', durationMin: 60, ...over });

describe('dayStats', () => {
  it('пустой день без практик: свободно 24 часа, перегруза нет', () => {
    const s = dayStats(DATE, [], [], []);
    expect(s.freeMin).toBe(1440);
    expect(s.plannedMin).toBe(0);
    expect(s.doneMin).toBe(0);
    expect(s.overloadMin).toBe(0);
    expect(s.summary).toContain('свободно 24ч 00м');
  });

  it('план = запланированные на дату, свободно уменьшается практиками и делами', () => {
    const todo = [
      task('a', { scheduledDate: DATE, scheduledStart: 600 }), // 10:00–11:00
    ];
    const practices = [new Practice({ id: 'p', title: 'Сон', days: [6], start: 1380, end: 420 })]; // 23:00–07:00
    const s = dayStats(DATE, todo, [], practices);
    expect(s.plannedMin).toBe(60);
    // занято: дело 60 + сон 480 (23:00–24:00 и 00:00–07:00) = 540, свободно 900
    expect(s.freeMin).toBe(900);
  });

  it('перегруз: неразобранных дел больше свободного времени', () => {
    const practices = [new Practice({ id: 'p', title: 'Сон', days: [6], start: 0, end: 1440 })]; // весь день занят
    const todo = [task('a'), task('b')]; // два свободных дела по 60 минут
    const s = dayStats(DATE, todo, [], practices);
    expect(s.freeMin).toBe(0);
    expect(s.overloadMin).toBe(120);
  });

  it('практика не в этот день не считается', () => {
    const practices = [new Practice({ id: 'p', title: 'Пары', days: [1, 2, 3, 4, 5], start: 540, end: 720 })];
    const s = dayStats(DATE, [], [], practices); // суббота
    expect(s.freeMin).toBe(1440);
  });

  it('отложенное на завтра не создаёт перегруз сегодняшнего дня', () => {
    const practices = [new Practice({ id: 'p', title: 'Сон', days: [6], start: 0, end: 1440 })];
    const todo = [
      task('tomorrow', { scheduledDate: '2026-10-25', scheduledStart: null }), // отложено
      task('free', {}), // сегодняшнее без времени
    ];
    const s = dayStats(DATE, todo, [], practices);
    expect(s.overloadMin).toBe(60); // только сегодняшнее
  });

  it('«сегодня без времени» не считается планом и не перегружает пустой день', () => {
    const todo = [task('undated-today', { scheduledDate: DATE, scheduledStart: null })];
    const s = dayStats(DATE, todo, [], []);
    expect(s.plannedMin).toBe(0);
    expect(s.overloadMin).toBe(0); // день пуст — места хватает
  });
});

describe('doneInLastDays', () => {
  const doneTask = (id, over = {}) =>
    new Task({ id, title: `дело ${id}`, group: 'Н', status: 'done', ...over });
  const DAY = 24 * 60 * 60 * 1000;

  it('считает закрытые дела по направлениям за окно', () => {
    const now = Date.now();
    const tasks = [
      doneTask('a', { sphereId: 's1', doneAt: now - 2 * DAY }),
      doneTask('b', { sphereId: 's1', doneAt: now - 3 * DAY }),
      doneTask('c', { sphereId: 's2', doneAt: now - 6 * DAY }),
      doneTask('d', { sphereId: 's3', doneAt: now - 9 * DAY }), // старше недели
    ];
    const m = doneInLastDays(tasks);
    expect(m.get('s1')).toBe(2);
    expect(m.get('s2')).toBe(1);
    expect(m.has('s3')).toBe(false);
    expect(m.size).toBe(2);
  });

  it('дело на границе окна (ровно 7 дней назад) ещё считается', () => {
    const now = Date.now();
    const m = doneInLastDays([doneTask('a', { sphereId: 's1', doneAt: now - 7 * DAY })]);
    expect(m.get('s1')).toBe(1);
  });

  it('дело из будущего не считается', () => {
    const m = doneInLastDays([doneTask('a', { sphereId: 's1', doneAt: Date.now() + DAY })]);
    expect(m.size).toBe(0);
  });

  it('без doneAt или со статусом todo — не считается', () => {
    const tasks = [
      doneTask('a', { sphereId: 's1', doneAt: null }), // закрыто давно, до появления поля
      new Task({ id: 'b', title: 'дело b', group: 'Н', sphereId: 's1', doneAt: Date.now() }), // todo
    ];
    expect(doneInLastDays(tasks).size).toBe(0);
  });

  it('дело без направления не попадает в сводку', () => {
    const m = doneInLastDays([doneTask('a', { sphereId: null, doneAt: Date.now() })]);
    expect(m.size).toBe(0);
  });

  it('пустой список — пустая карта, окно можно задать', () => {
    expect(doneInLastDays([]).size).toBe(0);
    const now = Date.now();
    const m = doneInLastDays([doneTask('a', { sphereId: 's1', doneAt: now - 2 * DAY })], 1);
    expect(m.size).toBe(0);
  });
});
