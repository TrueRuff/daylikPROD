// экранирование пользовательского текста перед вставкой в разметку
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// скачивание файла через временный <a download>
export function downloadFile(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

import { dayNames, todayStr, addDays, localInputToTs } from '../core/schedule.js';
import { t } from '../core/i18n.js';

// чекбоксы дней недели (1..7) — квадратики вплотную, состояние внутри плитки
export function daysCheckboxes(selected: number[] = [1, 2, 3, 4, 5, 6, 7]): string {
  return dayNames().map((d, i) =>
    `<label class="day"><input type="checkbox" data-day="${i + 1}"${selected.includes(i + 1) ? ' checked' : ''}><span>${d}</span></label>`
  ).join('');
}

// опции селекта групп Н/Ж/П с выделенной текущей
export function groupOptions(current: string): string {
  return ['Н', 'Ж', 'П'].map((g) =>
    `<option value="${g}"${g === current ? ' selected' : ''}>${g} — ${t(`group.${g}`)}</option>`).join('');
}

// цвет направления из id: детерминированный, но не случайный на вид —
// оттенок берётся из подобранной палитры с единой насыщенностью/светлотой.
// Находит по узнаванию (цвет одинаков на всех экранах), а не по чтению названия
const SPHERE_HUES = [8, 26, 45, 95, 140, 168, 192, 214, 245, 275, 305, 335];
export function sphereColor(id: unknown): string {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % SPHERE_HUES.length;
  return `hsl(${SPHERE_HUES[h]}, 55%, 52%)`;
}

// поле времени: 4 цифры (две в часы, две в минуты), двоеточие появляется само
export function timeInput(cls: string, value = '', optional = false): string {
  return `<input class="js-time ${cls}" type="text" inputmode="numeric" maxlength="5"
    placeholder="${optional ? '—' : '09:00'}" value="${value}">`;
}

// приведение набранного к 'ЧЧ:ММ'; пусто или мусор — пустая строка
export function normalizeTimeValue(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  const hh = Math.min(23, Number(digits.length > 2 ? digits.slice(0, -2) : digits));
  const mm = digits.length > 2 ? Math.min(59, Number(digits.slice(-2))) : 0;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// маска времени: двоеточие при вводе, нормализация при потере фокуса
export function bindTimeMasks(root: HTMLElement): void {
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || !el.classList.contains('js-time')) return;
    const digits = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = digits.length > 2
      ? `${digits.slice(0, -2)}:${digits.slice(-2)}`
      : digits;
  });
  const fix = (e: Event) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || !el.classList.contains('js-time')) return;
    el.value = normalizeTimeValue(el.value);
  };
  root.addEventListener('focusout', fix);
  root.addEventListener('change', fix);
}

// пара полей «Начало / Конец» — равные колонки, подпись над окошком
export function timeRangeFields(start = '09:00', end = '10:00'): string {
  return `
    <div class="time-range">
      <label>${t('common.start')} ${timeInput('js-start', start)}</label>
      <label>${t('common.end')} ${timeInput('js-end', end)}</label>
    </div>`;
}

export interface RemindFieldsOptions {
  date?: string;
  time?: string;
  open?: boolean;
}

// поле напоминания: быстрые дни чипами + дата и время (4 цифры) по кнопке
export function remindFieldsHtml(prefix: string, { date = '', time = '09:00', open = false }: RemindFieldsOptions = {}): string {
  return `
    <div class="row">
      <button type="button" class="grp chip" data-remind-days="1" data-remind-for="${prefix}">${t('task.remindTomorrow')}</button>
      <button type="button" class="grp chip" data-remind-days="2" data-remind-for="${prefix}">${t('task.remindDayAfter')}</button>
      <button type="button" class="grp chip" data-remind-days="7" data-remind-for="${prefix}">${t('task.remindWeek')}</button>
      <button type="button" class="grp chip" data-remind-open="${prefix}">${t('task.pickDate')}</button>
    </div>
    <div class="row remind-fields" id="${prefix}-remind-fields" ${open ? '' : 'hidden'}>
      <label>${t('task.remindDate')} <input id="${prefix}-remind-date" type="date" value="${date}"></label>
      <label>${t('task.remindTime')} ${timeInput(`js-${prefix}-remind-time`, time)}</label>
    </div>`;
}

// клик по чипам напоминания; true — клик потрачен
export function handleRemindClick(root: ParentNode, e: Event): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const chip = target.closest<HTMLElement>('[data-remind-days]');
  if (chip) {
    const forId = chip.dataset.remindFor as string;
    const dateInput = root.querySelector<HTMLInputElement>(`#${forId}-remind-date`);
    const fields = root.querySelector<HTMLElement>(`#${forId}-remind-fields`);
    if (dateInput) dateInput.value = addDays(todayStr(), Number(chip.dataset.remindDays));
    if (fields) fields.hidden = false;
    return true;
  }
  const open = target.closest<HTMLElement>('[data-remind-open]');
  if (open) {
    const fields = root.querySelector<HTMLElement>(`#${open.dataset.remindOpen as string}-remind-fields`);
    if (fields) fields.hidden = false;
    return true;
  }
  return false;
}

// готовые дата и время из полей напоминания -> timestamp или null
export function readRemindInput(root: ParentNode, prefix: string): number | null {
  const date = root.querySelector<HTMLInputElement>(`#${prefix}-remind-date`)?.value;
  if (!date) return null;
  const time = normalizeTimeValue(root.querySelector<HTMLInputElement>(`.js-${prefix}-remind-time`)?.value) || '09:00';
  return localInputToTs(`${date}T${time}`);
}
