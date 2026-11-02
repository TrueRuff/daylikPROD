// тесты демо-набора: сидирование пустого аккаунта и сброс по кнопке.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveTask, getTasks, getAllSpheres, getPractices,
  hasDemoData, deleteDemoData, setDataOwner, __clearForTests,
} from '../src/core/storage';
import { seedOnLogin } from '../src/core/demoData';
import { Task } from '../src/core/models';

beforeEach(async () => {
  await __clearForTests();
  setDataOwner('новичок');
});

afterEach(() => setDataOwner(null));

describe('демо-набор дня', () => {
  it('пустой аккаунт получает рутины, направления и дела', async () => {
    expect(await seedOnLogin()).toBe('full');
    const [spheres, practices, tasks] = await Promise.all([
      getAllSpheres(), getPractices(), getTasks(),
    ]);
    expect(spheres.length).toBe(3);
    expect(practices.length).toBe(6);
    expect(tasks.length).toBe(3);
    // всё принадлежит вошедшему и помечено как демо
    for (const row of [...spheres, ...practices, ...tasks]) {
      expect(row.owner).toBe('новичок');
      expect(row.demo).toBe(true);
    }
  });

  it('непустому аккаунту добавляются базовые дела, но один раз', async () => {
    await saveTask(new Task({ id: 'own', title: 'моё дело', group: 'Н' }));
    expect(await seedOnLogin()).toBe('tasks');
    const tasks = await getTasks();
    // своё дело осталось + три базовых
    expect(tasks.length).toBe(4);
    expect(tasks.some((x) => x.title === 'моё дело' && !x.demo)).toBe(true);
    // повторный вход ничего не добавляет
    expect(await seedOnLogin()).toBe(false);
    expect((await getTasks()).length).toBe(4);
  });

  it('повторный вызов ничего не дублирует', async () => {
    await seedOnLogin();
    expect(await seedOnLogin()).toBe(false);
    expect((await getAllSpheres()).length).toBe(3);
  });

  it('сброс удаляет демо-записи и оставляет свои', async () => {
    await seedOnLogin();
    await saveTask(new Task({ id: 'own', title: 'моё дело', group: 'Н' }));
    expect(await hasDemoData()).toBe(true);

    expect(await deleteDemoData()).toBe(12); // 3 сферы + 6 регулярных + 3 дела
    expect(await hasDemoData()).toBe(false);
    const [spheres, practices, tasks] = await Promise.all([
      getAllSpheres(), getPractices(), getTasks(),
    ]);
    expect(spheres.length).toBe(0);
    expect(practices.length).toBe(0);
    expect(tasks.map((x) => x.title)).toEqual(['моё дело']);
  });
});
