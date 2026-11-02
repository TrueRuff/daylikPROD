// экран входа: вход в существующий аккаунт или создание нового.
// после успеха вызывает onSuccess(account) — main.ts показывает приложение.

import { login, register, ensureBuiltinAdmin } from '../core/auth.js';
import { t, onChange } from '../core/i18n.js';
import type { Account } from '../core/storage.js';

export interface AuthScreen {
  show(): void;
}

export function initAuthScreen(root: HTMLElement, onSuccess: (acc: Account) => void | Promise<void>): AuthScreen {
  let mode: 'login' | 'register' = 'login';
  let lastError = '';

  function render(): void {
    root.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="icon-192.png" alt="">
        <h2>${t('app.name')}</h2>
        <p class="muted">${mode === 'login' ? t('auth.enter') : t('auth.register')}</p>
        <label>${t('auth.loginLabel')} <input id="a-login" autocomplete="username"></label>
        <label>${t('auth.passwordLabel')} <input id="a-pass" type="password" autocomplete="current-password"></label>
        ${lastError ? `<p class="auth-error">${t(lastError)}</p>` : ''}
        <button id="a-submit">${mode === 'login' ? t('auth.loginBtn') : t('auth.registerBtn')}</button>
        <button id="a-switch" class="secondary">${mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}</button>
      </div>`;
    root.querySelector<HTMLInputElement>('#a-login')!.focus();
  }

  async function submit(): Promise<void> {
    const name = root.querySelector<HTMLInputElement>('#a-login')!.value;
    const pass = root.querySelector<HTMLInputElement>('#a-pass')!.value;
    const res = mode === 'login' ? await login(name, pass) : await register(name, pass);
    if (res.error || !res.account) {
      lastError = res.error ?? 'auth.wrong';
      render();
      return;
    }
    lastError = '';
    onSuccess(res.account);
  }

  root.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.id === 'a-switch') {
      mode = mode === 'login' ? 'register' : 'login';
      lastError = '';
      render();
      return;
    }
    if (target.id === 'a-submit') await submit();
  });

  root.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Enter' && target.closest('#a-login, #a-pass')) submit();
  });

  onChange(render); // смена языка перерисовывает форму

  return {
    show() {
      ensureBuiltinAdmin().then(render);
    },
  };
}
