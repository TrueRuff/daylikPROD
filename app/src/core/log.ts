// журнал событий: уровни debug/info/warn/error, дублирование в консоль и
// асинхронный sink в IndexedDB (ставится при инициализации хранения).
// журналирование не должно ломать приложение: ошибки sink глотаются.

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

export interface LogEntry {
  time: number;
  level: LogLevel;
  event: string;
  data: unknown;
}

type Sink = (entry: LogEntry) => Promise<void> | void;

let sink: Sink | null = null;

function write(level: LogLevel, event: string, data?: unknown): LogEntry {
  const entry: LogEntry = { time: Date.now(), level, event, data: data ?? null };
  const fn = level === 'debug' ? 'log' : level;
  console[fn as 'log' | LogLevel](`[${level}] ${event}`, data ?? '');

  if (sink) {
    try {
      sink(entry)?.catch(() => {});
    } catch {
      // журнал не ломает приложение
    }
  }
  return entry;
}

export const log = {
  debug: (event: string, data?: unknown) => write('debug', event, data),
  info: (event: string, data?: unknown) => write('info', event, data),
  warn: (event: string, data?: unknown) => write('warn', event, data),
  error: (event: string, data?: unknown) => write('error', event, data),
};

export function setSink(fn: Sink): void {
  sink = fn;
}
