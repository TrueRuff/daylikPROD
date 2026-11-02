// Smoke-тест: каждый модуль приложения должен импортироваться без ошибок.
// Ловит битые имена/экспорты на уровне модулей. main.ts исключён: он точка входа
// и трогает DOM/цикл напоминаний — его загрузка проверяется в браузере.

import { describe, it, expect } from 'vitest';

const modules = import.meta.glob('../src/**/*.ts');

describe('модули приложения импортируются без ошибок', () => {
  for (const [path, load] of Object.entries(modules)) {
    if (path.endsWith('/main.ts')) continue; // точка входа: трогает DOM, проверяется в браузере
    it(path.replace('../src/', ''), async () => {
      await expect(load()).resolves.toBeTruthy();
    });
  }
});
