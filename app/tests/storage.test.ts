// Тесты слоя хранения на fake-indexeddb: полный цикл операций, включая
// завершение повторяющихся дел и каскадное удаление.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveSphere, saveTask, savePractice,
  getAllSpheres, getTasks, getPractices,
  updateTask, deleteTask, deleteSphere,
  getDueReminders, completeTask, initLog, getLogs, importAll,
  setDataOwner,
} from '../src/core/storage';
import { Sphere, Task, Practice } from '../src/core/models';

const sphere = (id, group = 'Н') => new Sphere({ id, name: `Направление ${id}`, group });
const task = (id, over = {}) => new Task({ id, title: `Дело ${id}`, group: 'Н', durationMin: 30, ...over });

beforeEach(async () => {
  const storage = await import('../src/core/storage');
  await storage.__clearForTests();
});

describe('разделение данных по аккаунтам', () => {
  afterEach(() => setDataOwner(null));

  it('запись штампуется владельцем, выборка видит только его', async () => {
    setDataOwner('bob');
    await saveTask(task('t1'));
    setDataOwner('alice');
    await saveTask(task('t2'));

    setDataOwner('bob');
    expect((await getTasks()).map((x) => x.id)).toEqual(['t1']);
    setDataOwner('alice');
    expect((await getTasks()).map((x) => x.id)).toEqual(['t2']);
    setDataOwner(null);
    expect((await getTasks()).length).toBe(2); // без входа фильтра нет
  });

  it('напоминания не протекают между аккаунтами', async () => {
    setDataOwner('bob');
    await saveTask(task('t1', { dueAt: 1000 }));
    setDataOwner('alice');
    expect(await getDueReminders(2000)).toEqual([]);
    setDataOwner('bob');
    expect((await getDueReminders(2000)).map((x) => x.id)).toEqual(['t1']);
  });

  it('импорт заменяет данные только текущего владельца', async () => {
    setDataOwner('bob');
    await saveTask(task('t1'));
    setDataOwner('alice');
    await saveTask(task('t2'));

    const data = { spheres: [], tasks: [{ id: 'n1', title: 'Новое', group: 'Ж', durationMin: 30 }], practices: [] };
    await importAll(data);
    expect((await getTasks()).map((x) => x.id)).toEqual(['n1']);
    setDataOwner('bob');
    expect((await getTasks()).map((x) => x.id)).toEqual(['t1']);
  });
});

describe('CRUD', () => {
  it('сохранение и выборка дел с фильтром по статусу', async () => {
    await saveTask(task('t1'));
    await saveTask(task('t2', { status: 'done' }));
    expect((await getTasks({ status: 'todo' })).map((x) => x.id)).toEqual(['t1']);
    expect((await getTasks()).length).toBe(2);
  });

  it('обновление патчем и удаление', async () => {
    await saveTask(task('t1'));
    await updateTask('t1', { group: 'Ж' });
    expect((await getTasks())[0].group).toBe('Ж');
    await deleteTask('t1');
    expect(await getTasks()).toEqual([]);
  });

  it('удаление направления каскадно удаляет его практики, но не дела', async () => {
    await saveSphere(sphere('s1'));
    await savePractice(new Practice({ id: 'p1', sphereId: 's1', title: 'Сон' }));
    await saveTask(task('t1', { sphereId: 's1' }));
    await deleteSphere('s1');
    expect(await getAllSpheres()).toEqual([]);
    expect(await getPractices()).toEqual([]);
    expect((await getTasks()).length).toBe(1); // дело осталось
  });
});

describe('getDueReminders', () => {
  it('выбирает только наступившие и незавершённые', async () => {
    const now = 1000;
    await saveTask(task('due', { dueAt: 500 }));
    await saveTask(task('future', { dueAt: 5000 }));
    await saveTask(task('done-due', { dueAt: 500, status: 'done' }));
    await saveTask(task('no-remind', { dueAt: null }));
    const due = await getDueReminders(now);
    expect(due.map((x) => x.id)).toEqual(['due']);
  });
});

describe('completeTask — повторяющиеся дела', () => {
  it('обычное дело просто завершается', async () => {
    await saveTask(task('t1'));
    const next = await completeTask(task('t1'));
    expect(next).toBeNull();
    const [stored] = await getTasks();
    expect(stored.status).toBe('done');
    expect(stored.scheduledDate).toBeNull();
  });

  it('ежедневное дело создаёт завтрашнее вхождение с тем же временем', async () => {
    const t = task('r1', { repeatRule: 'daily', scheduledDate: '2026-10-24', scheduledStart: 600 });
    await saveTask(t);
    const next = await completeTask(t);

    expect(next).not.toBeNull();
    expect(next.repeatRule).toBe('daily');
    expect(next.status).toBe('todo');
    expect(next.scheduledDate).toBe('2026-10-25');
    expect(next.scheduledStart).toBe(600);
    expect(next.id).not.toBe('r1');

    const todo = await getTasks({ status: 'todo' });
    const done = await getTasks({ status: 'done' });
    expect(todo.map((x) => x.id)).toEqual([next.id]);
    expect(done.map((x) => x.id)).toEqual(['r1']);
  });

  it('повтор every:3 сдвигает на три дня', async () => {
    const t = task('r2', { repeatRule: 'every:3', scheduledDate: '2026-10-24', scheduledStart: 0 });
    await saveTask(t);
    const next = await completeTask(t);
    expect(next.scheduledDate).toBe('2026-10-27');
  });
});

describe('журнал и импорт', () => {
  it('initLog пишет записи в таблицу журнала', async () => {
    initLog();
    const { log } = await import('../src/core/log');
    log.info('test.event', { a: 1 });
    await new Promise((r) => setTimeout(r, 50)); // даём sink'у дописать
    const rows = await getLogs();
    expect(rows[0].event).toBe('test.event');
  });

  it('импорт полностью заменяет данные', async () => {
    await saveTask(task('old'));
    await importAll({
      spheres: [{ id: 's1', name: 'Сон', group: 'Н' }],
      tasks: [{ id: 'n1', title: 'Новое', group: 'П', durationMin: 15 }],
      practices: [],
    });
    const tasks = await getTasks();
    expect(tasks.map((x) => x.id)).toEqual(['n1']);
    expect((await getAllSpheres()).map((x) => x.name)).toEqual(['Сон']);
  });
});
