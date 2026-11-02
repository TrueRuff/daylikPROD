import { describe, it, expect } from 'vitest';
import {
  buildDay, sortCandidates, adaptiveSort, autoPlaceLimit, recommendNow,
  findFreeWindow, computeFreeWindows, practicesToBlocks,
} from '../src/core/dayPlan';
import { Task, Practice } from '../src/core/models';

const task = (id, group, durationMin) =>
  new Task({ id, title: `дело ${id}`, group, durationMin });

describe('sortCandidates', () => {
  it('сортирует по приоритету группы, внутри группы — короткие раньше', () => {
    const sorted = sortCandidates([
      task('a', 'П', 20),
      task('b', 'Н', 60),
      task('c', 'Н', 30),
      task('d', 'Ж', 40),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('adaptiveSort — стратегия зависит от энергии', () => {
  const tasks = [
    task('big-need', 'Н', 120),
    task('small-want', 'Ж', 15),
    task('mid-need', 'Н', 45),
    task('small-useful', 'П', 20),
  ];

  it('low: лёгкие (<=30 мин) впереди независимо от группы', () => {
    const ids = adaptiveSort(tasks, 'low').map((t) => t.id);
    expect(ids.slice(0, 2).sort()).toEqual(['small-useful', 'small-want']);
    expect(ids).toContain('big-need'); // тяжёлое в конце, но не выброшено
    expect(ids[ids.length - 1]).toBe('big-need');
  });

  it('normal: как обычная сортировка', () => {
    expect(adaptiveSort(tasks, 'normal').map((t) => t.id))
      .toEqual(sortCandidates(tasks).map((t) => t.id));
  });

  it('high: внутри группы длинные вперёд', () => {
    const ids = adaptiveSort(tasks, 'high').map((t) => t.id);
    expect(ids[0]).toBe('big-need');   // Н-120 раньше Н-45
    expect(ids.indexOf('mid-need')).toBeLessThan(ids.indexOf('small-useful'));
  });

  it('autoPlaceLimit: уставшему максимум 3 дела', () => {
    expect(autoPlaceLimit('low')).toBe(3);
    expect(autoPlaceLimit('normal')).toBe(Infinity);
    expect(autoPlaceLimit('high')).toBe(Infinity);
  });
});

describe('recommendNow — одна рекомендация под текущий момент', () => {
  const windows = [{ start: 0, end: 600 }, { start: 780, end: 900 }]; // до 10:00 и 13:00–15:00
  const tasks = [task('short', 'Ж', 20), task('long', 'Н', 120)];

  it('берёт окно с текущей минутой и дело, влезающее в остаток окна', () => {
    const rec = recommendNow(windows, tasks, 540, 'normal'); // 9:00, до конца окна 60 минут
    expect(rec.task.id).toBe('short'); // 120-минутное не влезает, 20-минутное — да
    expect(rec.start).toBe(540);
  });

  it('если текущее окно прошло — ближайшее впереди', () => {
    const rec = recommendNow(windows, tasks, 700, 'normal'); // 11:40 между окнами
    expect(rec.window.start).toBe(780);
    expect(rec.start).toBe(780);
  });

  it('дело длиннее остатка окна не рекомендуется', () => {
    const only = [task('huge', 'Н', 240)];
    expect(recommendNow(windows, only, 540, 'normal')).toBeNull();
  });

  it('окон нет — null', () => {
    expect(recommendNow([], tasks, 100, 'normal')).toBeNull();
  });

  it('уставшему рекомендует лёгкое, а не важное длинное', () => {
    const both = [task('need-long', 'Н', 90), task('want-short', 'Ж', 20)];
    const rec = recommendNow([{ start: 0, end: 600 }], both, 60, 'low');
    expect(rec.task.id).toBe('want-short');
  });
});

describe('findFreeWindow', () => {
  it('находит окно между рутинами', () => {
    const blocks = [
      { start: 0, end: 480 },      // сон до 8:00
      { start: 540, end: 600 },    // рутина 9:00–10:00
    ];
    // 30-минутное дело влезает в 8:00–9:00 (480–540)
    expect(findFreeWindow(blocks, 30)).toEqual([480, 510]);
  });

  it('возвращает null, если дело никуда не влезает', () => {
    const blocks = [{ start: 0, end: 1439 }];
    expect(findFreeWindow(blocks, 60)).toBeNull();
  });
});

describe('computeFreeWindows', () => {
  it('находит все свободные промежутки', () => {
    const w = computeFreeWindows([{ start: 0, end: 480 }, { start: 540, end: 600 }]);
    expect(w).toEqual([{ start: 480, end: 540 }, { start: 600, end: 1440 }]);
  });

  it('без блоков весь день свободен', () => {
    expect(computeFreeWindows([])).toEqual([{ start: 0, end: 1440 }]);
  });
});

describe('buildDay', () => {
  it('практика через полночь разбивается на два блока', () => {
    const plan = buildDay('2026-10-24', [{ start: 1380, end: 420, label: 'Сон' }], []);
    const routines = plan.blocks.filter((b) => b.kind === 'routine');
    expect(routines.length).toBe(2); // 23:00–24:00 и 00:00–07:00
  });

  it('раскладывает дела по окнам, невлезающее — postponed', () => {
    const routines = [
      { start: 0, end: 480, label: 'Сон' },
      { start: 840, end: 900, label: 'Обед' },
    ];
    const tasks = [
      task('t1', 'Н', 60),   // влезает в 8:00–9:00
      task('t2', 'Н', 600),  // 10 часов свободного времени минус обед — 600 минут целиком не влезает
      task('t3', 'Ж', 30),
    ];
    const plan = buildDay('2026-10-23', routines, tasks);

    const taskBlocks = plan.blocks.filter((b) => b.kind === 'task');
    expect(taskBlocks.length).toBe(2); // 60 + 30 влезли, 600 не влезло
    expect(plan.postponed).toContain('t2');
  });

  it('buildDay не мутирует входные дела', () => {
    const tasks = [task('t1', 'Н', 60), task('t2', 'Н', 6000)];
    buildDay('2026-10-24', [{ start: 0, end: 480, label: 'Сон' }], tasks);
    expect(tasks.every((x) => x.status === 'todo' || x.status === undefined)).toBe(true);
  });

  it('пустой день без рутин и дел — пустой план', () => {
    const plan = buildDay('2026-10-24', [], []);
    expect(plan.blocks).toEqual([]);
    expect(plan.postponed).toEqual([]);
  });

  it('дело длиннее целого дня уходит в postponed, блоков не даёт', () => {
    const plan = buildDay('2026-10-24', [], [task('huge', 'Н', 2000)]);
    expect(plan.blocks).toEqual([]);
    expect(plan.postponed).toEqual(['huge']);
  });

  it('рутина start = end не даёт вырожденных блоков нулевой длины', () => {
    const plan = buildDay('2026-10-24', [{ start: 0, end: 0, label: 'Сбой' }], []);
    expect(plan.blocks.filter((b) => b.end <= b.start)).toEqual([]);
    expect(plan.blocks).toHaveLength(1); // трактуется как занятые целые сутки
  });
});

describe('practicesToBlocks — вырожденные полуночные отрезки', () => {
  it('start = end = 0 — один блок на весь день, без нулевого хвоста', () => {
    const blocks = practicesToBlocks([{ id: 'p', title: 'Сон', start: 0, end: 0 }]);
    expect(blocks).toEqual([{ start: 0, end: 1440, label: 'Сон', id: 'p' }]);
  });

  it('обычная полночная рутина не задета', () => {
    const blocks = practicesToBlocks([{ id: 'p', title: 'Сон', start: 1380, end: 420 }]);
    expect(blocks).toEqual([
      { start: 1380, end: 1440, label: 'Сон', id: 'p' },
      { start: 0, end: 420, label: 'Сон', id: 'p' },
    ]);
  });
});

describe('recommendNow — пятиминутная сетка', () => {
  it('округление старта не выталкивает дело за конец окна', () => {
    // 9:54, окно до 10:00; старт на сетке 9:55, 6-минутное дело кончилось бы в 10:01
    expect(recommendNow([{ start: 0, end: 600 }], [task('six', 'Н', 6)], 594, 'normal')).toBeNull();
  });

  it('влезающее после округления дело ставится на сетку', () => {
    const rec = recommendNow([{ start: 0, end: 600 }], [task('five', 'Н', 5)], 594, 'normal');
    expect(rec.start).toBe(595);
    expect(rec.end).toBe(600);
  });
});

describe('детерминизм сортировки', () => {
  it('дело без группы уходит в конец', () => {
    const sorted = sortCandidates([task('x', null, 10), task('y', 'Н', 60)]);
    expect(sorted.map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('при равной длительности порядок по id, не по порядку входа', () => {
    const a = task('a', 'Н', 30);
    const b = task('b', 'Н', 30);
    expect(sortCandidates([b, a]).map((t) => t.id)).toEqual(['a', 'b']);
    expect(adaptiveSort([b, a], 'low').map((t) => t.id)).toEqual(['a', 'b']);
    expect(adaptiveSort([b, a], 'high').map((t) => t.id)).toEqual(['a', 'b']);
  });
});
