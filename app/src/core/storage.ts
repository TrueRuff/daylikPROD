// слой хранения: IndexedDB через Dexie.
// единственная точка доступа к данным — всё остальное работает через этот модуль.

import Dexie, { type Table, type UpdateSpec } from 'dexie';
import { Sphere, Task, Practice } from './models.js';
import { normalizeImport } from './serialization.js';
import type { ExportData } from './serialization.js';
import { log, setSink, LEVELS } from './log.js';
import type { LogEntry, LogLevel } from './log.js';
import { nextOccurrence } from './recurring.js';

export interface Account {
  login: string;
  salt: string;
  passHash: string;
  role: 'admin' | 'user';
  createdAt?: number;
}

interface LogRow {
  id?: number;
  time: number;
  level: LogLevel;
  event: string;
  data: unknown;
}

interface DaylikDb extends Dexie {
  spheres: Table<Sphere, string>;
  tasks: Table<Task, string>;
  practices: Table<Practice, string>;
  logs: Table<LogRow, number>;
  accounts: Table<Account, string>;
}

const db = new Dexie('daylik') as DaylikDb;

db.version(1).stores({
  spheres: 'id, name, group',
  tasks: 'id, sphereId, group, status, dueAt',
});

db.version(2).stores({
  practices: 'id, sphereId',
});

db.version(3).stores({
  logs: '++id, time, level',
});

// v4: аккаунты + владелец у данных (разделение по учётным записям).
// существующие записи достаются встроенному админу — данные автора не теряются.
db.version(4).stores({
  accounts: 'login',
  spheres: 'id, name, group, owner',
  tasks: 'id, sphereId, group, status, dueAt, owner',
  practices: 'id, sphereId, owner',
}).upgrade(async (tx) => {
  for (const name of ['spheres', 'tasks', 'practices']) {
    await tx.table(name).toCollection().modify((row: { owner?: string }) => { row.owner = 'админ'; });
  }
});

// логин вошедшего аккаунта; null — фильтр выключен (до входа и в тестах)
let dataOwner: string | null = null;

export function setDataOwner(login: string | null): void {
  dataOwner = login;
}

export function getDataOwner(): string | null {
  return dataOwner;
}

interface OwnedRow {
  owner?: string | null;
}

// записи видимого владельца; без владельца (null) видно всё
function isOwned(row: OwnedRow): boolean {
  return dataOwner == null || row.owner === dataOwner;
}

function stampOwner<T extends OwnedRow>(row: T): T {
  if (dataOwner != null) row.owner = dataOwner;
  return row;
}

// демо-данные (помечены demo при создании из demoData.js)

const TABLES = () => [db.spheres, db.tasks, db.practices];

export async function hasDemoData(): Promise<boolean> {
  for (const table of TABLES()) {
    const rows = await table.filter((x) => x.demo && isOwned(x)).toArray();
    if (rows.length) return true;
  }
  return false;
}

export async function deleteDemoData(): Promise<number> {
  let removed = 0;
  for (const table of TABLES()) {
    const rows = await table.filter((x) => x.demo && isOwned(x)).toArray();
    if (rows.length) {
      await table.bulkDelete(rows.map((x) => x.id));
      removed += rows.length;
    }
  }
  if (removed) log.info('demo.cleared', { removed });
  return removed;
}

// аккаунты

export async function getAccount(login: string): Promise<Account | undefined> {
  return db.accounts.get(login);
}

export async function putAccount(account: Account): Promise<Account> {
  await db.accounts.put(account);
  return account;
}

export async function saveSphere(sphere: Sphere): Promise<Sphere> {
  await db.spheres.put(stampOwner(sphere));
  return sphere;
}

export async function saveTask(task: Task): Promise<Task> {
  await db.tasks.put(stampOwner(task));
  return task;
}

export async function getAllSpheres(): Promise<Sphere[]> {
  const rows = await db.spheres.filter(isOwned).toArray();
  return rows.map((r) => new Sphere(r));
}

export interface TaskFilter {
  status?: string | null;
  group?: string | null;
}

export async function getTasks({ status = null, group = null }: TaskFilter = {}): Promise<Task[]> {
  const rows = await db.tasks
    .filter((t) => isOwned(t) && (!status || t.status === status) && (!group || t.group === group))
    .toArray();
  return rows.map((r) => new Task(r));
}

export interface TaskPatch {
  status?: string;
  scheduledDate?: string | null;
  scheduledStart?: number | null;
  dueAt?: number | null;
  sphereId?: string | null;
  title?: string;
  durationMin?: number;
  notes?: string;
  [key: string]: unknown;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  await db.tasks.update(id, patch as unknown as UpdateSpec<Task>);
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

// завершение дела: обычное — просто done; повторяющееся — done + создаётся
// следующее вхождение (та же длительность/группа/повтор, место в расписании —
// на следующую дату). Возвращает созданное вхождение или null.
export async function completeTask(task: Task): Promise<Task | null> {
  await updateTask(task.id, { status: 'done', doneAt: Date.now(), scheduledDate: null, scheduledStart: null });
  const patch = nextOccurrence(task);
  if (!patch) return null;

  const next = new Task({
    ...task,
    id: crypto.randomUUID(),
    status: 'todo',
    createdAt: Date.now(),
    dueAt: null,
    ...patch,
  });
  await db.tasks.put(next);
  log.info('task.recurring.next', { title: next.title, rule: next.repeatRule, date: next.scheduledDate });
  return next;
}

// задачи с наступившим временем напоминания.
// фильтр по месту: в IndexedDB null меньше числа и попал бы в выборку belowThanOrEqual.
export async function getDueReminders(now: number): Promise<Task[]> {
  const rows = await db.tasks.filter((t) => isOwned(t) && t.dueAt != null && t.dueAt <= now && t.status !== 'done').toArray();
  return rows.map((r) => new Task(r));
}

export async function savePractice(practice: Practice): Promise<Practice> {
  await db.practices.put(stampOwner(practice));
  return practice;
}

export async function getPractices(): Promise<Practice[]> {
  const rows = await db.practices.filter(isOwned).toArray();
  return rows.map((r) => new Practice(r));
}

export async function deletePractice(id: string): Promise<void> {
  await db.practices.delete(id);
}

// сфера удаляется вместе со своими практиками
export async function deleteSphere(id: string): Promise<void> {
  await db.spheres.delete(id);
  await db.practices.where('sphereId').equals(id).delete();
}

// экспорт/импорт данных (см. serialization.js); без владельца — все записи,
// после входа — только данные текущего аккаунта
export async function exportAll(): Promise<ExportData> {
  const data = {
    spheres: (await db.spheres.toArray()).filter(isOwned),
    tasks: (await db.tasks.toArray()).filter(isOwned),
    practices: (await db.practices.toArray()).filter(isOwned),
  };
  log.info('storage.export', { spheres: data.spheres.length, tasks: data.tasks.length, practices: data.practices.length });
  return data;
}

// импорт с заменой данных текущего владельца (или всех, пока входа не было);
// возвращает очищенные записи
export async function importAll(data: unknown): Promise<ExportData> {
  const clean = normalizeImport(data);
  const stamp = <T extends OwnedRow>(rows: T[]): T[] => rows.map((r) => stampOwner({ ...r }));
  await db.transaction('rw', db.spheres, db.tasks, db.practices, async () => {
    if (dataOwner != null) {
      await db.spheres.where('owner').equals(dataOwner).delete();
      await db.tasks.where('owner').equals(dataOwner).delete();
      await db.practices.where('owner').equals(dataOwner).delete();
    } else {
      await db.spheres.clear();
      await db.tasks.clear();
      await db.practices.clear();
    }
    await db.spheres.bulkAdd(stamp(clean.spheres));
    await db.tasks.bulkAdd(stamp(clean.tasks));
    await db.practices.bulkAdd(stamp(clean.practices));
  });
  log.info('storage.import', { spheres: clean.spheres.length, tasks: clean.tasks.length, practices: clean.practices.length });
  return clean;
}

// тестовая утилита: полная очистка таблиц (используется только из тестов)
export async function __clearForTests(): Promise<void> {
  await db.spheres.clear();
  await db.tasks.clear();
  await db.practices.clear();
  await db.logs.clear();
  await db.accounts.clear();
}

// журнал: записи пишутся в таблицу logs, хвост длиннее LOG_CAP подрезается
const LOG_CAP = 1000;

export function initLog(): void {
  setSink(async (entry: LogEntry) => {
    await db.logs.add(entry);
    const count = await db.logs.count();
    if (count > LOG_CAP) {
      const excess = await db.logs.orderBy('id').limit(count - LOG_CAP).primaryKeys();
      await db.logs.bulkDelete(excess);
    }
  });
}

// последние записи журнала из базы (переживают перезапуск), сначала новые
export interface LogsFilter {
  limit?: number;
  minLevel?: LogLevel | null;
}

export async function getLogs({ limit = 200, minLevel = null }: LogsFilter = {}): Promise<LogEntry[]> {
  let rows = await db.logs.orderBy('time').reverse().limit(1000).toArray();
  if (minLevel) {
    const min = LEVELS[minLevel] ?? 0;
    rows = rows.filter((r) => (LEVELS[r.level] ?? 0) >= min);
  }
  return rows.slice(0, limit);
}

export async function clearLogs(): Promise<void> {
  await db.logs.clear();
  log.info('log.cleared');
}
