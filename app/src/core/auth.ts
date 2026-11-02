// аутентификация: аккаунты в IndexedDB (таблица accounts в storage.ts),
// сессия — JWT (HS256, Web Crypto) в localStorage. Токен живёт 30 дней и
// переживает перезапуск приложения; «Выйти» стирает его. Приложение локальное,
// без сервера — секрет подписи хранится в коде, проверка токена отсекает
// ручную подделку payload и просроченные сессии.

import { getAccount, putAccount } from './storage.js';
import type { Account } from './storage.js';
import { log } from './log.js';

const TOKEN_KEY = 'daylik-token';
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const SECRET = new TextEncoder().encode('daylik-local-hs256-secret');

// встроенный аккаунт разработчика: админ видит журнал событий
const BUILTIN = { login: 'админ', password: '123', role: 'admin' as const };

export interface TokenPayload {
  login?: string;
  role?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

// base64url

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const enc = new TextEncoder();

function b64urlFromJson(obj: unknown): string {
  return b64urlFromBytes(enc.encode(JSON.stringify(obj)));
}

function jsonFromB64url(str: string): TokenPayload {
  return JSON.parse(new TextDecoder().decode(bytesFromB64url(str)));
}

// пароли и подпись

// Web Crypto требует BufferSource; Uint8Array из TextEncoder приводим явно
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf(enc.encode(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// соль на аккаунт — одинаковые пароли дают разные хэши
async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// JWT

// подписывает payload (login, role), добавляя iat и exp; ttlMs — для тестов
export async function signToken(payload: TokenPayload, ttlMs: number = TOKEN_TTL_MS): Promise<string> {
  const issued = Date.now();
  const body = { ...payload, iat: issued, exp: issued + ttlMs };
  const data = `${b64urlFromJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlFromJson(body)}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), buf(enc.encode(data)));
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

// проверяет подпись и срок; битый/просроченный/чужой токен → null
export async function verifyToken(token: unknown): Promise<TokenPayload | null> {
  if (typeof token !== 'string') return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), buf(bytesFromB64url(s)), buf(enc.encode(`${h}.${p}`)));
    if (!ok) return null;
    const payload = jsonFromB64url(p);
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

// сессия в localStorage

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // без localStorage сессия живёт до перезапуска
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function dropToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // см. saveToken
  }
}

// выход: сессия стирается, данные остаются в базе под логином
export function logout(): void {
  dropToken();
}

// аккаунты

async function makeAccount(login: string, password: string, role: 'admin' | 'user'): Promise<Account> {
  const salt = crypto.randomUUID();
  return { login, salt, passHash: await hashPassword(password, salt), role, createdAt: Date.now() };
}

// встроенный админ (админ/123) создаётся при первом показе экрана входа
export async function ensureBuiltinAdmin(): Promise<void> {
  if (await getAccount(BUILTIN.login)) return;
  await putAccount(await makeAccount(BUILTIN.login, BUILTIN.password, BUILTIN.role));
  log.info('auth.builtinAdmin', { login: BUILTIN.login });
}

export type AuthResult =
  | { account: Account; token: string; error?: undefined }
  | { error: string; account?: undefined; token?: undefined };

// возвращает { account, token } или { error: ключ словаря }
export async function register(login: unknown, password: unknown): Promise<AuthResult> {
  const name = String(login || '').trim();
  const pass = String(password || '');
  if (!name || !pass) return { error: 'auth.empty' };
  if (pass.length < 3) return { error: 'auth.short' };
  if (await getAccount(name)) return { error: 'auth.taken' };

  const account = await makeAccount(name, pass, 'user');
  await putAccount(account);
  const token = await signToken({ login: account.login, role: account.role });
  saveToken(token);
  log.info('auth.register', { login: account.login });
  return { account, token };
}

export async function login(login: unknown, password: unknown): Promise<AuthResult> {
  const account = await getAccount(String(login || '').trim());
  if (!account) return { error: 'auth.wrong' };
  if (await hashPassword(String(password || ''), account.salt) !== account.passHash) {
    return { error: 'auth.wrong' };
  }
  const token = await signToken({ login: account.login, role: account.role });
  saveToken(token);
  log.info('auth.login', { login: account.login });
  return { account, token };
}

// восстановление сессии при запуске: токен из localStorage проверяется
// подписью и сроком, аккаунт должен существовать
export async function restoreSession(): Promise<Account | null> {
  const token = readToken();
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) {
    dropToken();
    return null;
  }
  const account = await getAccount(payload.login as string);
  if (!account) {
    dropToken();
    return null;
  }
  return account;
}

export function isAdmin(account: Account | null | undefined): boolean {
  return account?.role === 'admin';
}
