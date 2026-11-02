// точка входа: вход в аккаунт, вкладки, экраны, цикл напоминаний, язык интерфейса

import './styles.css';
import '@fontsource-variable/inter';
import { initDayScreen } from './ui/dayScreen.js';
import { initCalendarScreen } from './ui/calendarScreen.js';
import { initSpheresScreen } from './ui/spheresScreen.js';
import { openAddModal } from './ui/inputScreen.js';
import { initLogScreen } from './ui/logScreen.js';
import { initAuthScreen } from './ui/authScreen.js';
import { startReminderLoop, fireNotification, requestPermission } from './core/reminders.js';
import { getDueReminders, updateTask, initLog, setDataOwner } from './core/storage.js';
import { restoreSession, logout as authLogout, isAdmin } from './core/auth.js';
import { seedOnLogin } from './core/demoData.js';
import { openOnboarding } from './ui/onboarding.js';
import { log } from './core/log.js';
import { getLang, setLang, onChange, applyStatic, t } from './core/i18n.js';
import type { Account } from './core/storage.js';

type TabName = 'day' | 'calendar' | 'spheres' | 'log';

const screens: Record<TabName, HTMLElement> = {
  day: document.getElementById('tab-day')!,
  calendar: document.getElementById('tab-calendar')!,
  spheres: document.getElementById('tab-spheres')!,
  log: document.getElementById('tab-log')!,
};

const appEl = document.getElementById('app')!;
const authRoot = document.getElementById('auth')!;
const whoEl = document.getElementById('who')!;
const avatarEl = document.getElementById('who-avatar')!;
const logoutBtn = document.getElementById('logout') as HTMLButtonElement;
const langBtn = document.getElementById('lang') as HTMLButtonElement;
const addBtn = document.getElementById('add') as HTMLButtonElement;
const helpBtn = document.getElementById('help') as HTMLButtonElement;
const logTabBtn = document.querySelector<HTMLButtonElement>('nav button[data-tab="log"]')!;

// «+ Добавить» — единственный путь к полному вводу (экрана «Ввод» больше нет)
addBtn.addEventListener('click', () => openAddModal());
// «?» — обзор приложения со скриншотами
helpBtn.addEventListener('click', () => openOnboarding());

initLog();

// необработанные ошибки и rejection'ы — в журнал: иначе сбой обработчика
// интерфейса не оставляет следов и не попадает в «Журнал» для отладки
const reportError = (message: string) => log.error('app.unhandled', { message });
window.addEventListener('error', (e) => reportError(e.message));
window.addEventListener('unhandledrejection', (e) => reportError(String(e.reason)));

initDayScreen(screens.day);
initCalendarScreen(screens.calendar);
initSpheresScreen(screens.spheres);
initLogScreen(screens.log);

const buttons = document.querySelectorAll<HTMLButtonElement>('nav button');
let currentTab: TabName = 'day';
let account: Account | null = null; // вошедший аккаунт (auth.js)

function showTab(name: TabName): void {
  currentTab = name;
  for (const [key, el] of Object.entries(screens) as [TabName, HTMLElement][]) el.hidden = key !== name;
  const shown = screens[name];
  shown.classList.remove('screen-in');
  void shown.offsetWidth; // перезапуск анимации при повторном показе
  shown.classList.add('screen-in');
  buttons.forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    // на телефоне лента вкладок прокручивается к активной (свайп мог увести)
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  document.dispatchEvent(new CustomEvent('tab-shown', { detail: name }));
}

buttons.forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.tab === 'log' && !isAdmin(account)) return; // журнал — только админу
  showTab(b.dataset.tab as TabName);
}));

// модалка «Добавить» сохранила данные — перерисовать активный экран
document.addEventListener('data-changed', () => {
  if (account) showTab(currentTab);
});

// свайпы на телефоне: горизонтальный жест листает вкладки. Жесты, нужные
// самим экранам (календарь, перетаскивание дел, поля ввода), исключены.
const SWIPE_MIN = 70;
let swipe: { x: number; y: number } | null = null;

document.addEventListener('touchstart', (e) => {
  const target = e.target as Element | null;
  if (e.touches.length !== 1 || !target?.closest) { swipe = null; return; }
  if (target.closest('nav, .task-row, .sphere-item, .tl-card, .cal-shell, .modal-overlay, input, textarea, select')) {
    swipe = null;
    return;
  }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dy = e.changedTouches[0].clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2) return;
  const tabs = [...buttons].filter((b) => !b.hidden).map((b) => b.dataset.tab);
  const i = tabs.indexOf(currentTab);
  const next = tabs[i + (dx < 0 ? 1 : -1)];
  if (next) showTab(next as TabName);
}, { passive: true });

// вход и выход

async function enterApp(acc: Account): Promise<void> {
  account = acc;
  setDataOwner(acc.login); // дальнейшие чтения и записи — только его данные
  authRoot.hidden = true;
  appEl.hidden = false;
  whoEl.hidden = false;
  whoEl.textContent = acc.login;
  avatarEl.hidden = false;
  avatarEl.textContent = (acc.login[0] || '?').toUpperCase();
  logoutBtn.hidden = false;
  langBtn.hidden = false;
  addBtn.hidden = false;
  helpBtn.hidden = false;
  themeBtn.hidden = false;
  logTabBtn.hidden = !isAdmin(acc);
  refreshBell();
  // в пустой аккаунт — демо-день второй смены, в остальные — базовые дела
  // (убираются кнопкой на «Направлениях»); отказ сидирования не мешает входу
  try {
    await seedOnLogin();
  } catch (err) {
    log.warn('demo.seedFailed', { message: err instanceof Error ? err.message : String(err) });
  }
  showTab('day');
}

function showLogin(): void {
  account = null;
  setDataOwner(null);
  authRoot.hidden = false;
  appEl.hidden = true;
  whoEl.hidden = true;
  avatarEl.hidden = true;
  logoutBtn.hidden = true;
  langBtn.hidden = true;
  addBtn.hidden = true;
  helpBtn.hidden = true;
  authScreen.show();
}

logoutBtn.addEventListener('click', () => {
  log.info('auth.logout', { login: account?.login });
  authLogout();
  showLogin();
});

const authScreen = initAuthScreen(authRoot, enterApp);

// сессия из прошлого запуска: валидный токен — сразу в приложение,
// иначе экран входа (там же при первом запуске создаётся встроенный админ)
restoreSession().then((acc) => {
  if (acc) enterApp(acc);
  else showLogin();
  log.info('app.start', { lang: getLang(), account: acc?.login ?? null });
});

// язык: кнопка показывает язык, на который переключит; смена перерисовывает экраны

function refreshLangBtn(): void {
  langBtn.textContent = getLang() === 'ru' ? 'EN' : 'RU';
}

langBtn.addEventListener('click', () => {
  setLang(getLang() === 'ru' ? 'en' : 'ru');
});

onChange(() => {
  document.title = `${t('app.name')} — ${t('nav.day')}`;
  applyStatic();
  refreshLangBtn();
  if (account) showTab(currentTab); // перерисовать активный экран на новом языке
});

applyStatic();
refreshLangBtn();

// тема: светлая/тёмная, старт — по сохранённому выбору или системной
// (первичная установка делает inline-скрипт в index.html до отрисовки)
const themeBtn = document.getElementById('theme') as HTMLButtonElement;
const THEME_KEY = 'daylik-theme';

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/></svg>';

function refreshThemeBtn(): void {
  themeBtn.innerHTML = currentTheme() === 'dark' ? SUN_SVG : MOON_SVG;
  // строка заголовка Android (PWA) следует за темой приложения
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = currentTheme() === 'dark' ? '#131417' : '#f4f4f6';
}

themeBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // сохранение не критично
  }
  refreshThemeBtn();
  log.info('theme.change', { theme: next });
});
refreshThemeBtn();

// уведомления: разрешение спрашиваем кнопкой, затем работает цикл напоминаний
const bell = document.getElementById('bell') as HTMLButtonElement;
function refreshBell(): void {
  bell.hidden = typeof Notification !== 'undefined' && Notification.permission === 'granted';
}
bell.addEventListener('click', async () => {
  await requestPermission();
  refreshBell();
});

startReminderLoop(
  (now) => getDueReminders(now),
  (task) => {
    fireNotification(task);
    updateTask(task.id, { dueAt: null }); // напоминание разовое
  }
);

// service worker — только в продакшн-сборке (на dev-сервере кэш мешал бы
// свежему коду), в браузере по http/https; Electron работает с file://
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    log.warn('sw.registerFailed', { message: err instanceof Error ? err.message : String(err) });
  });
}
