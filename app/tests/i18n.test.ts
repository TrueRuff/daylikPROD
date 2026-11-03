import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, getLang, setLang, DICTS } from '../src/core/i18n.js';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('i18n — локализация', () => {
  beforeEach(() => setLang('ru'));
  afterEach(() => setLang('ru'));

  it('словари ru и en содержат одинаковый набор ключей', () => {
    const ru = Object.keys(DICTS.ru).sort();
    const en = Object.keys(DICTS.en).sort();
    expect(en).toEqual(ru);
  });

  it('t отдаёт перевод текущего языка и переключается', () => {
    expect(getLang()).toBe('ru');
    expect(t('nav.day')).toBe('День');
    setLang('en');
    expect(t('nav.day')).toBe('Day');
  });

  it('подстановка параметров {name}', () => {
    setLang('en');
    expect(t('task.saved', { title: 'Cook', group: 'Н' })).toBe('Task "Cook" saved, group Н.');
  });

  it('неизвестный ключ возвращается сам ключом', () => {
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('setLang игнорирует неизвестный язык', () => {
    setLang('de');
    expect(getLang()).toBe('ru');
  });

  it('массив dayNames доступен как обычный ключ', () => {
    setLang('en');
    expect(t('dayNames')[0]).toBe('Mo');
  });
});

describe('все ключи словаря используются', () => {
  it('мёртвых ключей нет (учтены data-i18n из index.html и шаблонные вызовы)', () => {
    const used = new Set();

    const walk = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.ts')) {
          const src = readFileSync(p, 'utf8');
          for (const m of src.matchAll(/t\(\s*'([^']+)'/g)) used.add(m[1]);
          // шаблонные ключи вида t(`prefix.${...}`) — фиксируем префикс
          for (const m of src.matchAll(/t\(\s*`([^`${]+)/g)) used.add(m[1]);
        }
      }
    };
    walk(join(appRoot, 'src'));

    // статические узлы index.html
    const html = readFileSync(join(appRoot, 'index.html'), 'utf8');
    for (const m of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) used.add(m[1]);

    // ключи, собираемые динамически по префиксу (auth.* — коды ошибок из auth.js)
    const dyn = ['auth.', 'group.', 'level.', 'energy.', 'kind.', 'provider.', 'type.', 'schedule.', 'input.preset'];
    const dead = Object.keys(DICTS.ru).filter(
      (k) => !used.has(k) && !dyn.some((p) => k.startsWith(p)) && k !== 'dayNames'
    );
    expect(dead).toEqual([]);
  });
});
