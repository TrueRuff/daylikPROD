import { describe, it, expect, vi } from 'vitest';
import { log, setSink, LEVELS } from '../src/core/log';

describe('log — журнал событий', () => {
  it('уровни имеют возрастающий порядок важности', () => {
    expect(LEVELS.debug).toBeLessThan(LEVELS.info);
    expect(LEVELS.info).toBeLessThan(LEVELS.warn);
    expect(LEVELS.warn).toBeLessThan(LEVELS.error);
  });

  it('sink получает запись с временем, уровнем, событием и данными', async () => {
    const seen = [];
    setSink(async (entry) => seen.push(entry));
    log.info('test.event', { a: 1 });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe('info');
    expect(seen[0].event).toBe('test.event');
    expect(seen[0].data).toEqual({ a: 1 });
    expect(seen[0].time).toBeGreaterThan(0);
    setSink(null);
  });

  it('падение sink не выбрасывает наружу', () => {
    setSink(() => { throw new Error('sink down'); });
    expect(() => log.info('still.works')).not.toThrow();
    setSink(null);
  });

  it('уровни пишутся соответствующими методами консоли', () => {
    const calls = [];
    const orig = { ...console };
    for (const m of ['log', 'info', 'warn', 'error']) {
      console[m] = (...a) => calls.push([m, ...a]);
    }
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    Object.assign(console, orig);
    expect(calls.map((c) => c[0])).toEqual(['log', 'info', 'warn', 'error']);
  });
});
