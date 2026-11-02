import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startReminderLoop, fireNotification } from '../src/core/reminders';

describe('startReminderLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('раз в минуту спрашивает наступившие и передаёт их в onFire', async () => {
    const due = [{ id: 't1', title: 'Позвонить' }];
    const getDue = vi.fn().mockResolvedValue(due);
    const onFire = vi.fn();

    const stop = startReminderLoop(getDue, onFire);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getDue).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith(due[0]);

    stop();
  });

  it('останавливается возвращённой функцией', async () => {
    const getDue = vi.fn().mockResolvedValue([]);
    const stop = startReminderLoop(getDue, vi.fn());

    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(getDue).toHaveBeenCalledTimes(1);
  });

  it('пустой список — onFire не вызывается', async () => {
    const onFire = vi.fn();
    startReminderLoop(vi.fn().mockResolvedValue([]), onFire);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('fireNotification', () => {
  it('без разрешения ничего не создаёт', () => {
    const ctor = vi.fn();
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'denied' }));

    fireNotification({ id: 't1', title: 'X' });
    expect(ctor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('с разрешением показывает уведомление с названием дела', () => {
    const ctor = vi.fn();
    vi.stubGlobal('Notification', Object.assign(ctor, { permission: 'granted' }));

    fireNotification({ id: 't1', title: 'Позвонить маме' });
    expect(ctor).toHaveBeenCalledTimes(1);
    const [title, opts] = ctor.mock.calls[0];
    expect(title).toBeTruthy(); // локализованное имя приложения
    expect(opts.body).toBe('Позвонить маме');
    expect(opts.tag).toBe('t1'); // дубликаты схлопываются
    vi.unstubAllGlobals();
  });
});

describe('startReminderLoop — устойчивость', () => {
  it('отказ getDueReminders не выбрасывает необработанный rejection', async () => {
    const { startReminderLoop } = await import('../src/core/reminders');
    let calls = 0;
    const stop = startReminderLoop(async () => {
      calls += 1;
      throw new Error('база недоступна');
    }, () => {}, 5);
    await new Promise((r) => setTimeout(r, 40));
    stop();
    expect(calls).toBeGreaterThan(0);
  });
});
