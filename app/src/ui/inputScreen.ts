// модалка «Добавить»: свободный текст → разбор → подтверждение типа и
// группы. Открывается кнопкой «+» в шапке из любого места приложения
// (отдельного экрана ввода больше нет).

import { categorize } from '../core/categorize.js';
import type { CategorizeResult } from '../core/categorize.js';
import { Task, Sphere } from '../core/models.js';
import type { SphereGroup } from '../core/models.js';
import { saveTask, saveSphere, getAllSpheres } from '../core/storage.js';
import { t, onChange } from '../core/i18n.js';
import { escapeHtml, bindTimeMasks, remindFieldsHtml, handleRemindClick, readRemindInput, sphereColor, repeatFieldsHtml, presetChipKeys } from './dom.js';

type AddKind = 'task' | 'ongoing' | 'sphere';

interface AddState {
  parsed: CategorizeResult;
  kind: AddKind;
  rawText: string;
  group: SphereGroup;
  spheres: Sphere[];
  sphere: string; // '' — без направления
}

let root: HTMLElement | null = null;   // контейнер модалки, живёт на странице
let state: AddState | null = null;     // текущий разбор (после «Разобрать»)
let savedMsg: string | null = null;    // подтверждение после сохранения

function kindTitle(kind: AddKind): string {
  return t(`kind.${kind}`);
}

function providerTitle(parsed: CategorizeResult): string {
  if (parsed.provider === 'llm') return t('provider.llm');
  return parsed.llmFailed ? t('provider.llmFailed') : t('provider.rules');
}

// иконки типов: выбор по узнаванию, без чтения подписей
const TYPE_ICONS: Record<AddKind, string> = {
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg>',
  ongoing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  sphere: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8l-1.8 4.6-4.6 1.8 1.8-4.6z"/></svg>',
};

// длительность: поле + чипы быстрого выбора — общие для разового и продолжительного
function durationHtml(def: number): string {
  return `
      <div class="row">
        <label>${t('task.duration')} <input id="c-dur" type="number" min="5" step="5" value="${def}"></label>
      </div>
      <div class="chips">
        ${[10, 20, 30, 60].map((m) => `<button type="button" class="grp chip${m === def ? ' on' : ''}" data-dur="${m}">${m}</button>`).join('')}
      </div>`;
}

// поля, зависящие от типа: при смене типа перерисовывается только этот блок,
// кнопки типов/группы и набранный текст остаются на месте (без мерцания).
// «Продолжительное» — дело с повтором (проект по 30 минут в день); рутины
// (сон, готовка) создаются не здесь, а на «Направлениях».
function extraHtml(): string {
  const def = state!.parsed.durationMin || 30;
  if (state!.kind === 'ongoing') {
    return `${durationHtml(def)}
      ${repeatFieldsHtml('c', null, false)}`;
  }
  if (state!.kind !== 'task') return '';
  return `${durationHtml(def)}
    <details class="more-params">
      <summary>${t('task.moreParams')}</summary>
      <p class="muted">${t('task.moreParamsHint')}</p>
      <label>${t('task.remind')}</label>
      ${remindFieldsHtml('c')}
      ${repeatFieldsHtml('c')}
    </details>`;
}

// выбор направления крупными чипами: приложение само предлагает подходящее
// (по группе из разбора), группа наследуется от направления — Н/Ж/П вручную
// не выбираются. Возврат к делу тоже «за руку»: цвет направления потом
// виден на всех экранах
function sphereChipsHtml(): string {
  const chips = state!.spheres.map((s) =>
    `<button type="button" class="grp chip${s.id === state!.sphere ? ' on' : ''}" data-sphere="${s.id}">
      <span class="sphere-dot" style="background:${sphereColor(s.id)}"></span>${escapeHtml(s.name)}
    </button>`);
  return `
    <p class="muted">${t('input.sphereQ')}</p>
    <div class="chips">
      <button type="button" class="grp chip${state!.sphere ? '' : ' on'}" data-sphere="">${t('input.noSphere')}</button>
      ${chips.join('')}
    </div>
    <p class="muted small-hint">${t('input.sphereHint')}</p>`;
}

// кнопки групп — только для типа «Направление»: там группа задаётся прямо
function groupButtonsHtml(): string {
  return `
    <div class="row">
      ${t('common.group')}:
      ${['Н', 'Ж', 'П'].map((g) =>
        `<button type="button" class="grp${g === state!.group ? ' on' : ''}" data-g="${g}">${g} — ${t(`group.${g}`)}</button>`).join('')}
    </div>`;
}

function confirmCardHtml(): string {
  return `
    <div class="card">
      <div class="row between">
        <strong id="c-kind">${kindTitle(state!.kind)}</strong>
        <span class="muted">${providerTitle(state!.parsed)}</span>
      </div>
      <div class="row">
        ${t('common.type')}:
        ${(['task', 'ongoing', 'sphere'] as AddKind[]).map((k) =>
          `<button type="button" class="grp${k === state!.kind ? ' on' : ''}" data-kind="${k}">${TYPE_ICONS[k]}${t(`type.${k}`)}</button>`).join('')}
      </div>
      <p class="muted" id="c-hint">${t(`type.hint.${state!.kind}`)}</p>
      <label>${t('common.title')} <input id="c-title" value="${escapeHtml(state!.parsed.title)}"></label>
      <div id="c-grouping">${state!.kind === 'sphere' ? groupButtonsHtml() : sphereChipsHtml()}</div>
      <div id="c-extra">${extraHtml()}</div>
      <div class="row"><button id="c-save">${t('common.save')}</button></div>
    </div>`;
}

function render(): void {
  if (!root) return;
  const confirmHtml = savedMsg
    ? `<div class="card"><p>${escapeHtml(savedMsg)}</p></div>`
    : (state ? confirmCardHtml() : '');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="row between modal-head">
          <strong>${t('input.title')}</strong>
          <button id="add-close" class="icon-btn" title="${t('common.close')}">✕</button>
        </div>
        <p class="muted">${t('input.intro')}</p>
        <div class="input-row">
          <input id="raw" placeholder="${t('input.placeholder')}" value="${escapeHtml(state?.rawText || '')}">
          <button id="parse">${t('input.parse')}</button>
        </div>
        ${state || savedMsg ? '' : `
        <div class="chips">
          ${presetChipKeys().map((key) => `<button type="button" class="grp chip" data-preset="${key}">${t(key)}</button>`).join('')}
        </div>`}
        <div id="confirm">${confirmHtml}</div>
      </div>
    </div>`;
}

// подсветка выбранных кнопок — как радиокнопки, без перерисовки
function syncTypeButtons(): void {
  root!.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === state!.kind));
}

function syncGroupButtons(): void {
  root!.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => b.classList.toggle('on', b.dataset.g === state!.group));
}

function syncKind(): void {
  root!.querySelector<HTMLElement>('#c-kind')!.textContent = kindTitle(state!.kind);
  root!.querySelector<HTMLElement>('#c-hint')!.textContent = t(`type.hint.${state!.kind}`);
  root!.querySelector<HTMLElement>('#c-grouping')!.innerHTML = state!.kind === 'sphere' ? groupButtonsHtml() : sphereChipsHtml();
  root!.querySelector<HTMLElement>('#c-extra')!.innerHTML = extraHtml();
  syncTypeButtons();
}

export function openAddModal(): void {
  if (!root) {
    root = document.createElement('div');
    root.id = 'add-modal';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => onClick(e));
    root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).id === 'raw' && e.key === 'Enter') parse();
    });
    root.addEventListener('change', (e) => {
      if ((e.target as HTMLElement).id === 'c-repeat') {
        const wrap = root!.querySelector<HTMLElement>('#c-repeat-n-wrap');
        if (wrap) wrap.hidden = (e.target as HTMLSelectElement).value !== 'every';
      }
    });
    bindTimeMasks(root);
    // смена языка перерисовывает открытую модалку
    onChange(() => {
      if (isOpen()) render();
    });
  }
  state = null;
  savedMsg = null;
  render();
  root.querySelector<HTMLInputElement>('#raw')?.focus();
}

function isOpen(): boolean {
  return Boolean(root && root.innerHTML);
}

function closeModal(): void {
  state = null;
  savedMsg = null;
  if (root) root.innerHTML = '';
}

async function parse(): Promise<void> {
  const rawEl = root!.querySelector<HTMLInputElement>('#raw')!;
  const text = rawEl.value.trim();
  if (!text) return;
  // разбор может идти несколько секунд (LLM) — кнопка показывает, что работает
  const parseBtn = root!.querySelector<HTMLButtonElement>('#parse');
  if (!parseBtn || parseBtn.disabled) return;
  parseBtn.disabled = true;
  parseBtn.textContent = '…';
  try {
    const [parsed, spheres] = await Promise.all([categorize(text), getAllSpheres()]);
    // рутина из разбора — это продолжительное дело; сами рутины создаются на «Направлениях»
    const kind: AddKind = parsed.kind === 'routine' ? 'ongoing' : parsed.kind;
    // предлагаем направление с той же группой, что вышла из разбора —
    // пользователь подтверждает одним тапом, а не ищет в селекте
    const suggested = parsed.group ? spheres.find((s) => s.group === parsed.group) : null;
    state = { parsed, kind, rawText: text, group: parsed.group || 'П', spheres, sphere: kind === 'task' || kind === 'ongoing' ? (suggested?.id || '') : '' };
  } finally {
    // после успешного разбора render() перерисует модалку с новой кнопкой;
    // здесь возвращаем кнопку на случай, если разбор не дошёл до отрисовки
    const btn = root!.querySelector<HTMLButtonElement>('#parse');
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('input.parse');
    }
  }
  render();
  root!.querySelector<HTMLInputElement>('#raw')?.focus();
}

async function save(): Promise<void> {
  const confirmEl = root!.querySelector<HTMLElement>('#confirm')!;
  const { rawText } = state!;
  const title = confirmEl.querySelector<HTMLInputElement>('#c-title')!.value.trim();
  if (!title) return;
  const id = crypto.randomUUID();

  if (state!.kind === 'sphere') {
    await saveSphere(new Sphere({ id, name: title, group: state!.group }));
    savedMsg = t('spheres.saved', { title });
  } else {
    const dur = Number(confirmEl.querySelector<HTMLInputElement>('#c-dur')!.value) || 30;
    const sphere = state!.spheres.find((s) => s.id === state!.sphere) || null;
    const repeatKind = confirmEl.querySelector<HTMLSelectElement>('#c-repeat')!.value;
    const repeatN = Number(confirmEl.querySelector<HTMLInputElement>('#c-repeat-n')?.value) || 3;
    // продолжительное дело — то же разовое, но с повтором; после завершения
    // возвращается по расписанию (recurring)
    await saveTask(new Task({
      id,
      rawText,
      title,
      group: sphere ? sphere.group : state!.group,
      durationMin: dur,
      sphereId: sphere ? sphere.id : null,
      dueAt: state!.kind === 'task' ? readRemindInput(root!, 'c') : null,
      status: 'todo',
      source: state!.parsed.provider,
      repeatRule: state!.kind === 'ongoing'
        ? (repeatKind === 'every' ? `every:${repeatN}` : 'daily')
        : (repeatKind === 'every' ? `every:${repeatN}` : (repeatKind || null)),
    }));
    const remindDate = root!.querySelector<HTMLInputElement>('#c-remind-date')?.value;
    savedMsg = t('task.saved', { title, group: state!.group })
      + (state!.kind === 'task' && remindDate ? ` ${t('task.willRemind')}` : '');
  }
  state = null;
  render();
  // активный экран перерисуется с новыми данными (main.ts слушает)
  document.dispatchEvent(new CustomEvent('data-changed'));
}

async function onClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement;
  if (target.classList.contains('modal-overlay') || target.closest('#add-close')) {
    closeModal();
    return;
  }
  if (handleRemindClick(root!, e)) return;
  if (target.id === 'parse') {
    await parse();
    return;
  }
  // чип-пример: подставить текст и разобрать сразу — старт без придумывания
  const preset = target.closest<HTMLElement>('[data-preset]');
  if (preset) {
    const rawEl = root!.querySelector<HTMLInputElement>('#raw');
    if (rawEl) rawEl.value = t(preset.dataset.preset as string);
    await parse();
    return;
  }
  const kindBtn = target.closest<HTMLElement>('[data-kind]');
  if (kindBtn && state) {
    state.kind = kindBtn.dataset.kind as AddKind;
    syncKind();
    return;
  }
  const grp = target.closest<HTMLElement>('[data-g]');
  if (grp && state) {
    state.group = grp.dataset.g as SphereGroup;
    syncGroupButtons();
    return;
  }
  // чип направления: группа наследуется от направления
  const sphereChip = target.closest<HTMLElement>('[data-sphere]');
  if (sphereChip && state) {
    state.sphere = sphereChip.dataset.sphere as string;
    const sphere = state.spheres.find((s) => s.id === state!.sphere);
    if (sphere) state.group = sphere.group;
    root!.querySelectorAll<HTMLElement>('.chip[data-sphere]').forEach((c) => c.classList.toggle('on', c === sphereChip));
    return;
  }
  // чип длительности: выбор вместо набора цифр
  const chip = target.closest<HTMLElement>('[data-dur]');
  if (chip) {
    const dur = root!.querySelector<HTMLInputElement>('#c-dur');
    if (dur) dur.value = chip.dataset.dur as string;
    root!.querySelectorAll<HTMLElement>('.chip[data-dur]').forEach((c) => c.classList.toggle('on', c === chip));
    return;
  }
  if (target.id === 'c-save' && state) await save();
}
