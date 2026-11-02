// сериализация данных приложения: JSON (читаемый) и собственный двоичный
// формат .daylik (компактный резервный). Плюс normalizeImport — проверка и
// чистка данных перед записью в базу.

import { Sphere, Task, Practice, GROUPS } from './models.js';
import { isRepeatRule } from './recurring.js';
import type { SphereGroup, SphereProps, TaskProps, PracticeProps } from './models.js';

const FORMAT = 'daylik';
const FORMAT_VERSION = 1;
const MAGIC = 'DAYL'; // сигнатура двоичного файла

export interface ExportData {
  spheres: Sphere[];
  tasks: Task[];
  practices: Practice[];
}

export interface ParsedJson {
  format: string;
  version: number;
  exportedAt: string;
  spheres: unknown;
  tasks: unknown;
  practices: unknown;
}

// поля сущностей для двоичного формата: [имя, тип]
// str / u32 / f64, суффикс ? — nullable, u32[] — массив чисел
type FieldType = 'str' | 'u32' | 'f64' | 'u32[]' | 'str?' | 'u32?' | 'f64?';
type SchemaField = [name: string, type: FieldType];

const SCHEMAS: Record<'spheres' | 'tasks' | 'practices', SchemaField[]> = {
  spheres: [
    ['id', 'str'], ['name', 'str'], ['group', 'str'],
    ['brief', 'str'], ['details', 'str'], ['createdAt', 'f64'],
  ],
  tasks: [
    ['id', 'str'], ['sphereId', 'str?'], ['rawText', 'str'], ['title', 'str'],
    ['group', 'str'], ['durationMin', 'u32'], ['status', 'str'],
    ['scheduledDate', 'str?'], ['scheduledStart', 'u32?'], ['dueAt', 'f64?'],
    ['repeatRule', 'str?'], ['notes', 'str'], ['createdAt', 'f64'], ['source', 'str'],
  ],
  practices: [
    ['id', 'str'], ['sphereId', 'str?'], ['title', 'str'],
    ['days', 'u32[]'], ['start', 'u32'], ['end', 'u32'],
  ],
};

export function serializeJson(data: ExportData): string {
  return JSON.stringify({
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    spheres: data.spheres,
    tasks: data.tasks,
    practices: data.practices,
  });
}

export function parseJson(text: string): ParsedJson | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  const o = obj as ParsedJson | null;
  if (!o || o.format !== FORMAT) return null;
  return o;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  u8(v: number): void {
    this.push(new Uint8Array([v & 0xff]));
  }

  u32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  }

  f64(v: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, Number(v) || 0, true);
    this.push(b);
  }

  str(s: unknown): void {
    const b = ENCODER.encode(String(s ?? ''));
    this.u32(b.length);
    this.push(b);
  }

  result(): Uint8Array {
    const out = new Uint8Array(this.size);
    let pos = 0;
    for (const c of this.chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}

class Reader {
  private view: DataView;
  private offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  str(): string {
    const len = this.u32();
    const s = DECODER.decode(new Uint8Array(this.view.buffer, this.offset, len));
    this.offset += len;
    return s;
  }
}

function writeValue(writer: Writer, type: FieldType, value: unknown): void {
  if (type.endsWith('?')) {
    if (value == null) {
      writer.u8(0);
    } else {
      writer.u8(1);
      writeValue(writer, type.slice(0, -1) as FieldType, value);
    }
    return;
  }
  switch (type) {
    case 'str': writer.str(value); break;
    case 'u32': writer.u32(Number(value)); break;
    case 'f64': writer.f64(Number(value)); break;
    case 'u32[]': {
      const arr = Array.isArray(value) ? value : [];
      writer.u32(arr.length);
      for (const v of arr) writer.u32(Number(v));
      break;
    }
  }
}

function readValue(reader: Reader, type: FieldType): unknown {
  if (type.endsWith('?')) {
    return reader.u8() === 1 ? readValue(reader, type.slice(0, -1) as FieldType) : null;
  }
  switch (type) {
    case 'str': return reader.str();
    case 'u32': return reader.u32();
    case 'f64': return reader.f64();
    case 'u32[]': {
      const count = reader.u32();
      const arr: number[] = [];
      for (let i = 0; i < count; i++) arr.push(reader.u32());
      return arr;
    }
  }
}

export function serializeBinary(data: ExportData): Uint8Array {
  const w = new Writer();
  for (const ch of MAGIC) w.u8(ch.charCodeAt(0));
  w.u8(FORMAT_VERSION);

  for (const [key, fields] of Object.entries(SCHEMAS) as [keyof ExportData, SchemaField[]][]) {
    const raw = data[key];
    const list = (Array.isArray(raw) ? raw : []) as unknown as Record<string, unknown>[];
    w.u32(list.length);
    for (const item of list) {
      for (const [name, type] of fields) writeValue(w, type, item[name]);
    }
  }
  return w.result();
}

export interface ParsedBinary {
  spheres: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  practices: Record<string, unknown>[];
}

// битый файл (обрыв, мусор) даёт null, а не исключение
export function parseBinary(buffer: ArrayBuffer): ParsedBinary | null {
  try {
    const r = new Reader(buffer);
    for (const ch of MAGIC) {
      if (r.u8() !== ch.charCodeAt(0)) return null;
    }
    if (r.u8() !== FORMAT_VERSION) return null;

    const data: Record<string, unknown> = {};
    for (const [key, fields] of Object.entries(SCHEMAS) as [string, SchemaField[]][]) {
      const count = r.u32();
      const list: Record<string, unknown>[] = [];
      for (let i = 0; i < count; i++) {
        const item: Record<string, unknown> = {};
        for (const [name, type] of fields) item[name] = readValue(r, type);
        list.push(item);
      }
      data[key] = list;
    }
    return data as unknown as ParsedBinary;
  } catch {
    return null;
  }
}

function safeGroup(g: unknown): SphereGroup {
  return GROUPS.includes(g as SphereGroup) ? g as SphereGroup : 'П';
}

function safeInt(v: unknown, fallback: number, min: number, max: number): number;
function safeInt(v: unknown, fallback: null, min: number, max: number): number | null;
function safeInt(v: unknown, fallback: number | null, min: number, max: number): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

// id попадает в html-атрибуты (data-id, value) и в UID ics — оставляем
// только безопасные токены; записи с кавычками, скобками или чрезмерной
// длиной отбрасываем целиком
function safeId(v: unknown): string | null {
  return typeof v === 'string' && /^[\w.-]{1,64}$/.test(v) ? v : null;
}

// дубликаты id: остаётся первое вхождение, иначе импорт упадёт на записи в базу
function dedupeById<T extends { id: unknown }>(rows: T[]): T[] {
  const seen = new Set<unknown>();
  return rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
}

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []) as Record<string, unknown>[];

// проверка импортируемых данных: отбрасываем записи без обязательных полей,
// ссылки на несуществующие сферы обнуляем (сфера могла быть удалена),
// мусорные числа и группы заменяем безопасными значениями — иначе
// чужой файл сломал бы таймлайн (NaN в стиле блоков) и сортировку
export function normalizeImport(obj: unknown): ExportData {
  const sphereRows = arr((obj as ParsedJson | null)?.spheres);

  const spheres = dedupeById(sphereRows
    .filter((s) => s && safeId(s.id) && s.name)
    .map((s) => {
      const sphere = new Sphere({ ...s, id: safeId(s.id) } as unknown as SphereProps);
      sphere.group = safeGroup(sphere.group);
      return sphere;
    }));
  const sphereIds = new Set(spheres.map((s) => s.id));
  const refOrphan = (id: unknown) => (id && sphereIds.has(id as string) ? id as string : null);

  const tasks = dedupeById(arr((obj as ParsedJson | null)?.tasks)
    .filter((t) => t && safeId(t.id) && t.title)
    .map((t) => {
      const task = new Task({ ...t, id: safeId(t.id) } as unknown as TaskProps);
      task.sphereId = refOrphan(task.sphereId);
      task.group = safeGroup(task.group);
      task.durationMin = safeInt(task.durationMin, 30, 5, 480);
      if (!isRepeatRule(task.repeatRule)) task.repeatRule = null;
      task.status = task.status === 'done' ? 'done' : 'todo';
      task.scheduledDate = typeof task.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledDate)
        ? task.scheduledDate
        : null;
      task.scheduledStart = task.scheduledStart == null ? null : safeInt(task.scheduledStart, null, 0, 1439);
      task.dueAt = task.dueAt == null || !Number.isFinite(Number(task.dueAt)) ? null : Number(task.dueAt);
      return task;
    }));

  const practices = dedupeById(arr((obj as ParsedJson | null)?.practices)
    .filter((p) => p && safeId(p.id) && p.title)
    .map((p) => {
      const practice = new Practice({ ...p, id: safeId(p.id) } as unknown as PracticeProps);
      practice.sphereId = refOrphan(practice.sphereId);
      practice.start = safeInt(practice.start, 0, 0, 1440);
      practice.end = safeInt(practice.end, practice.start || 0, 0, 1440);
      // дни недели: числа 1..7 без повторов; строки вроде '2' приводим к числу
      practice.days = [...new Set((practice.days || [])
        .map((d) => Math.round(Number(d)))
        .filter((d) => d >= 1 && d <= 7))];
      return practice;
    }));

  return { spheres, tasks, practices };
}
