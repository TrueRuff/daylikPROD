// модели данных (см. проектирование.md, раздел 2)

export type SphereGroup = 'Н' | 'Ж' | 'П'; // Необходимо / Желательно / Полезно
// названия групп — в словаре локализации (i18n.js), ключи group.Н / group.Ж / group.П

export const GROUPS: readonly SphereGroup[] = ['Н', 'Ж', 'П'];

export type TaskStatus = 'todo' | 'done';
export type TaskSource = 'rules' | 'llm' | 'manual';

export interface SphereProps {
  id: string;
  name: string;
  group: SphereGroup;
  brief?: string;   // краткий текст — перечитывается каждый день
  details?: string; // полный текст: методы, рутина
  demo?: boolean;   // запись из демо-набора — удаляется кнопкой сброса
  createdAt?: number;
  owner?: string | null; // логин аккаунта-владельца (auth.js)
}

export class Sphere {
  id: string;
  name: string;
  group: SphereGroup;
  brief: string;
  details: string;
  demo: boolean;
  createdAt: number;
  owner: string | null;

  constructor({
    id, name, group, brief = '', details = '', demo = false, createdAt = Date.now(), owner = null,
  }: SphereProps) {
    this.id = id;
    this.name = name;
    this.group = group;
    this.brief = brief;
    this.details = details;
    this.demo = demo;
    this.createdAt = createdAt;
    this.owner = owner;
  }
}

export interface TaskProps {
  id: string;
  sphereId?: string | null;
  rawText?: string;
  title: string;
  group: SphereGroup;
  durationMin?: number;
  status?: TaskStatus;
  scheduledDate?: string | null; // 'YYYY-MM-DD' — день на таймлайне
  scheduledStart?: number | null; // минуты от 00:00
  dueAt?: number | null;
  repeatRule?: string | null;
  notes?: string;
  demo?: boolean;
  createdAt?: number;
  source?: TaskSource;
  owner?: string | null;
}

export class Task {
  id: string;
  sphereId: string | null;
  rawText: string;
  title: string;
  group: SphereGroup;
  durationMin: number;
  status: TaskStatus;
  scheduledDate: string | null;
  scheduledStart: number | null;
  dueAt: number | null;
  repeatRule: string | null;
  notes: string;
  demo: boolean;
  createdAt: number;
  source: TaskSource;
  owner: string | null;

  constructor({
    id, sphereId = null, rawText = '', title, group, durationMin = 30, status = 'todo',
    scheduledDate = null, scheduledStart = null, dueAt = null, repeatRule = null, notes = '',
    demo = false, createdAt = Date.now(), source = 'manual', owner = null,
  }: TaskProps) {
    this.id = id;
    this.sphereId = sphereId;
    this.rawText = rawText;
    this.title = title;
    this.group = group;
    this.durationMin = durationMin;
    this.status = status;
    this.scheduledDate = scheduledDate;
    this.scheduledStart = scheduledStart;
    this.dueAt = dueAt;
    this.repeatRule = repeatRule;
    this.notes = notes;
    this.demo = demo;
    this.createdAt = createdAt;
    this.source = source;
    this.owner = owner;
  }
}

// регулярная практика направления (сон, тренировки, пары); в интерфейсе Sphere — «Направление»
export interface PracticeProps {
  id: string;
  sphereId?: string | null;
  title: string;
  days?: number[];
  start?: number;
  end?: number;
  demo?: boolean;
  owner?: string | null;
}

export class Practice {
  id: string;
  sphereId: string | null;
  title: string;
  days: number[]; // дни недели 1..7, 1 = понедельник
  start: number;  // минуты от 00:00
  end: number;    // может быть меньше start — практика через полночь
  demo: boolean;
  owner: string | null;

  constructor({
    id, sphereId = null, title, days = [1, 2, 3, 4, 5, 6, 7], start = 540, end = 600, demo = false, owner = null,
  }: PracticeProps) {
    this.id = id;
    this.sphereId = sphereId;
    this.title = title;
    this.days = days;
    this.start = start;
    this.end = end;
    this.demo = demo;
    this.owner = owner;
  }
}

export type PlanBlockKind = 'routine' | 'task' | 'free';

// блок таймлайна дня
export class PlanBlock {
  id?: string;
  start: number; // минуты от 00:00
  end: number;
  kind: PlanBlockKind;
  label: string | null;
  taskId: string | null;

  constructor({
    id, start, end, kind = 'free', label = null, taskId = null,
  }: {
    id?: string;
    start: number;
    end: number;
    kind?: PlanBlockKind;
    label?: string | null;
    taskId?: string | null;
  }) {
    this.id = id;
    this.start = start;
    this.end = end;
    this.kind = kind;
    this.label = label;
    this.taskId = taskId;
  }

  get durationMin(): number {
    return this.end - this.start;
  }
}
