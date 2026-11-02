// Тесты аутентификации: JWT-сессии, аккаунты, встроенный админ.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

// localStorage-заглушка для node-окружения (в браузере он есть из коробки)
globalThis.localStorage = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
})();

import {
  login, register, logout, restoreSession, ensureBuiltinAdmin,
  signToken, verifyToken, isAdmin,
} from '../src/core/auth';
import { getAccount, __clearForTests } from '../src/core/storage';

beforeEach(async () => {
  await __clearForTests();
  localStorage.clear();
});

describe('аккаунты', () => {
  it('регистрация создаёт аккаунт и хранит пароль хэшем с солью', async () => {
    const res = await register('bob', 'secret');
    expect(res.error).toBeUndefined();
    expect(res.account.role).toBe('user');
    const row = await getAccount('bob');
    expect(row.passHash).not.toContain('secret');
    expect(row.passHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.salt).toBeTruthy();
  });

  it('регистрация отклоняет занятый логин, пустые поля и короткий пароль', async () => {
    await register('bob', 'secret');
    expect((await register('bob', 'other')).error).toBe('auth.taken');
    expect((await register('', 'secret')).error).toBe('auth.empty');
    expect((await register('alice', '')).error).toBe('auth.empty');
    expect((await register('alice', '12')).error).toBe('auth.short');
  });

  it('вход: неверный пароль и неизвестный логин — одна ошибка', async () => {
    await register('bob', 'secret');
    expect((await login('bob', 'nope')).error).toBe('auth.wrong');
    expect((await login('nobody', 'secret')).error).toBe('auth.wrong');
  });

  it('вход правильным паролем возвращает валидный токен', async () => {
    await register('bob', 'secret');
    const res = await login('bob', 'secret');
    expect(res.token).toBeTruthy();
    const payload = await verifyToken(res.token);
    expect(payload.login).toBe('bob');
    expect(payload.role).toBe('user');
    expect(payload.exp).toBeGreaterThan(Date.now());
  });
});

describe('JWT', () => {
  it('подписанный payload читается обратно', async () => {
    const token = await signToken({ login: 'x', role: 'user' }, 60_000);
    expect((await verifyToken(token)).login).toBe('x');
  });

  it('просроченный токен отклоняется', async () => {
    const token = await signToken({ login: 'x' }, -1000);
    expect(await verifyToken(token)).toBeNull();
  });

  it('токен с изменённой подписью и мусор отклоняются', async () => {
    const token = await signToken({ login: 'x' }, 60_000);
    expect(await verifyToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await verifyToken('не токен')).toBeNull();
    expect(await verifyToken('a.b.c')).toBeNull();
  });
});

describe('встроенный админ', () => {
  it('аккаунт админ/123 создаётся и даёт роль admin', async () => {
    await ensureBuiltinAdmin();
    const res = await login('админ', '123');
    expect(res.error).toBeUndefined();
    expect(isAdmin(res.account)).toBe(true);
  });

  it('повторный вызов не пересоздаёт аккаунт', async () => {
    await ensureBuiltinAdmin();
    await ensureBuiltinAdmin();
    expect(isAdmin((await login('админ', '123')).account)).toBe(true);
  });

  it('обычный аккаунт — не админ', async () => {
    await register('bob', 'secret');
    expect(isAdmin((await login('bob', 'secret')).account)).toBe(false);
  });
});

describe('сессия', () => {
  it('восстанавливается после перезапуска и стирается выходом', async () => {
    await register('bob', 'secret');
    expect((await restoreSession())?.login).toBe('bob');
    logout();
    expect(await restoreSession()).toBeNull();
  });

  it('мусор в хранилище токена сессию не восстанавливает', async () => {
    await register('bob', 'secret');
    localStorage.setItem('daylik-token', 'abc.abc.abc');
    expect(await restoreSession()).toBeNull();
  });

  it('валидный токен без аккаунта (аккаунт удалён) — входа нет', async () => {
    await register('bob', 'secret');
    const token = localStorage.getItem('daylik-token');
    await __clearForTests(); // аккаунты стёрты, токен остался
    localStorage.setItem('daylik-token', token);
    expect(await restoreSession()).toBeNull();
  });
});
