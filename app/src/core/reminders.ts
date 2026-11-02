// планировщик напоминаний (обязательная функция темы).
// каркас: проверка раз в минуту, при наступлении времени — Notifications API.

import { log } from './log.js';
import { t } from './i18n.js';
import type { Task } from './models.js';

export type GetDueReminders = (now: number) => Promise<Task[]>;

// возвращает функцию остановки цикла
export function startReminderLoop(
  getDueReminders: GetDueReminders,
  onFire: (task: Task) => void,
  intervalMs: number = 60_000,
): () => void {
  const tick = async () => {
    try {
      const due = await getDueReminders(Date.now());
      for (const task of due) onFire(task);
    } catch (err) {
      // отказ базы не должен ронять цикл напоминаний
      log.error('reminder.tickFailed', { message: err instanceof Error ? err.message : String(err) });
    }
  };
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export function fireNotification(task: Task): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  log.info('reminder.fired', { title: task.title });
  new Notification(t('app.name'), { body: task.title, tag: task.id });
}
