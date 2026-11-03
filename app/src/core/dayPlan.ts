// календарь дня: рутины занимают таймлайн, в свободные окна подбираются дела.
// ключевая алгоритмическая часть темы: фильтрация + сортировка + упаковка по времени.
// контракт: buildDay(date, routines, tasks) → DayPlan { date, blocks }

import { PlanBlock } from './models.js';
import type { Practice, Task } from './models.js';

const MINUTES_IN_DAY = 24 * 60;

// уровень энергии пользователя: low — упадок, normal — обычный, high — подъём
export type Energy = 'low' | 'normal' | 'high';

// отрезок занятости таймлайна (рутина или поставленное дело)
export interface Occupancy {
  start: number;
  end: number;
  label?: string | null;
  id?: string;
}

export interface FreeWindow {
  start: number;
  end: number;
}

export interface DayPlan {
  date: string;
  blocks: PlanBlock[];
  postponed: string[];
}

export interface Recommendation {
  task: Task;
  start: number;
  end: number;
  window: FreeWindow;
}

// сортировка дел при подборе: группа Н важнее Ж, Ж важнее П; внутри группы — короткие раньше.
// дело без распознанной группы уходит в конец; при полном равенстве порядок по id,
// чтобы результат не зависел от порядка входа
const GROUP_PRIORITY: Record<string, number> = { 'Н': 0, 'Ж': 1, 'П': 2 };
const groupRank = (g: string) => GROUP_PRIORITY[g] ?? 9;
const byId = (a: Task, b: Task) => String(a.id).localeCompare(String(b.id));

export function sortCandidates(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const g = groupRank(a.group) - groupRank(b.group);
    if (g !== 0) return g;
    if (a.durationMin !== b.durationMin) return a.durationMin - b.durationMin;
    return byId(a, b);
  });
}

// уровень энергии меняет стратегию подбора дел:
// low — уставшему нужны лёгкие: первыми короткие (<=30 мин), затем важность группы;
// high — на подъёме берём большие дела: внутри группы длинные вперёд.
const LIGHT_MAX = 30;

export function adaptiveSort(tasks: Task[], energy: Energy): Task[] {
  if (energy === 'low') {
    return [...tasks].sort((a, b) => {
      const la = a.durationMin <= LIGHT_MAX ? 0 : 1;
      const lb = b.durationMin <= LIGHT_MAX ? 0 : 1;
      if (la !== lb) return la - lb;
      const g = groupRank(a.group) - groupRank(b.group);
      if (g !== 0) return g;
      if (a.durationMin !== b.durationMin) return a.durationMin - b.durationMin;
      return byId(a, b);
    });
  }
  if (energy === 'high') {
    return [...tasks].sort((a, b) => {
      const g = groupRank(a.group) - groupRank(b.group);
      if (g !== 0) return g;
      if (a.durationMin !== b.durationMin) return b.durationMin - a.durationMin;
      return byId(a, b);
    });
  }
  return sortCandidates(tasks);
}

// сколько дел автоукладка ставит за раз: уставшему — не больше трёх,
// остальное подождёт и не давит
export function autoPlaceLimit(energy: Energy): number {
  return energy === 'low' ? 3 : Infinity;
}

// рекомендация «что сейчас»: окно с текущей минутой (или ближайшее впереди),
// в нём — первое подходящее по длительности и энергии дело
export function recommendNow(windows: FreeWindow[], tasks: Task[], nowMin: number, energy: Energy): Recommendation | null {
  const win = windows.find((w) => nowMin >= w.start && nowMin < w.end)
    || windows.find((w) => w.start > nowMin);
  if (!win) return null;

  const from = Math.max(win.start, nowMin);
  const start = Math.ceil(from / 5) * 5; // к пятиминутной сетке
  const available = win.end - start; // влезание считаем уже после округления
  const fitting = adaptiveSort(tasks.filter((x) => x.durationMin <= available), energy);
  const task = fitting[0];
  if (!task) return null;

  return { task, start, end: start + task.durationMin, window: win };
}

// отрезки суток для практики; через полночь (end <= start) — два отрезка.
// вырожденные отрезки нулевой длины (например, start = end = 0) отбрасываются
function midnightSplit(start: number, end: number): Occupancy[] {
  if (end <= start) {
    return [
      { start, end: MINUTES_IN_DAY },
      { start: 0, end },
    ].filter((b) => b.end > b.start);
  }
  return [{ start, end }];
}

// практики дня в блоки занятости; через полночь (end <= start) разбивается на два.
// id практики переносится в блоки — по нему таймлайн открывает редактирование
export function practicesToBlocks(practices: Practice[]): Occupancy[] {
  const out: Occupancy[] = [];
  for (const p of practices) {
    for (const b of midnightSplit(p.start, p.end)) {
      out.push({ start: b.start, end: b.end, label: p.title, id: p.id });
    }
  }
  return out;
}

// все свободные промежутки между блоками
export function computeFreeWindows(blocks: Occupancy[]): FreeWindow[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const out: FreeWindow[] = [];
  let cursor = 0;
  for (const b of sorted) {
    if (b.start - cursor > 0) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (MINUTES_IN_DAY - cursor > 0) out.push({ start: cursor, end: MINUTES_IN_DAY });
  return out;
}

// первое свободное окно, куда влезает дело длительностью durationMin: [start, end] или null
export function findFreeWindow(blocks: Occupancy[], durationMin: number): [number, number] | null {
  const w = computeFreeWindows(blocks).find((x) => x.end - x.start >= durationMin);
  return w ? [w.start, w.start + durationMin] : null;
}

export interface BuildDayOptions {
  sort?: (tasks: Task[]) => Task[];
}

// можно ли поставить дело на start: без пересечений с занятостью и в пределах дня.
// ignoreTaskId — блок самого перетаскиваемого дела (себя не считаем)
export function buildDay(date: string, routines: Occupancy[], tasks: Task[], { sort = sortCandidates }: BuildDayOptions = {}): DayPlan {
  const blocks: PlanBlock[] = [];

  for (const r of routines) {
    // практика через полночь (например, сон 23:00–07:00) — два блока
    for (const b of midnightSplit(r.start, r.end)) {
      blocks.push(new PlanBlock({ start: b.start, end: b.end, kind: 'routine', label: r.label ?? null }));
    }
  }

  // жадная упаковка: кандидаты по стратегии сортировки, каждый — в первое свободное окно
  const candidates = sort(tasks);
  const placedIds = new Set<string>();

  for (const task of candidates) {
    const window = findFreeWindow(blocks, task.durationMin);
    if (window) {
      blocks.push(new PlanBlock({ start: window[0], end: window[1], kind: 'task', taskId: task.id, label: task.title }));
      placedIds.add(task.id);
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  return { date, blocks, postponed: candidates.filter((t) => !placedIds.has(t.id)).map((t) => t.id) };
}
