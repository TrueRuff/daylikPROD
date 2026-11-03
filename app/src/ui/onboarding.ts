// обзор приложения (кнопка «?»): скриншоты экранов с пронумерованными
// метками и легендой. Метки заданы в процентах кадра — переживают смену
// языка интерфейса, но не переезды элементов вёрстки.

import { t, onChange } from '../core/i18n.js';

let root: HTMLElement | null = null;

interface OnbSection {
  img: string;
  title: string;
  markers: [number, number][];
  items: string[];
}

// структура строится при отрисовке: подписи зависят от текущего языка
function buildSections(): OnbSection[] {
  return [
    {
      img: 'onboarding/day.png',
      title: t('onb.day.title'),
      markers: [[9, 11], [57, 15], [48, 46], [48, 56], [80, 51], [60, 32], [54, 24], [87, 44]],
      items: [
        t('onb.day.1'), t('onb.day.2'), t('onb.day.3'), t('onb.day.4'),
        t('onb.day.5'), t('onb.day.6'), t('onb.day.7'), t('onb.day.8'),
      ],
    },
    {
      img: 'onboarding/add.png',
      title: t('onb.add.title'),
      markers: [[45, 25], [38, 35], [49, 53], [35, 63], [49, 75], [49, 86]],
      items: [
        t('onb.add.1'), t('onb.add.2'), t('onb.add.3'), t('onb.add.4'),
        t('onb.add.5'), t('onb.add.6'),
      ],
    },
    {
      img: 'onboarding/areas.png',
      title: t('onb.areas.title'),
      markers: [[35, 19], [35, 25], [60, 25], [29, 34], [26, 56], [28, 66]],
      items: [
        t('onb.areas.1'), t('onb.areas.2'), t('onb.areas.3'), t('onb.areas.4'),
        t('onb.areas.5'), t('onb.areas.6'),
      ],
    },
    {
      img: 'onboarding/calendar.png',
      title: t('onb.cal.title'),
      markers: [[25, 9], [26, 23], [39, 31]],
      items: [t('onb.cal.1'), t('onb.cal.2'), t('onb.cal.3')],
    },
  ];
}

function render(): void {
  if (!root) return;
  const sections = buildSections()
    .map((s) => `
      <h3>${s.title}</h3>
      <div class="onb-shot">
        <img src="${s.img}" alt="" loading="lazy">
        ${s.markers.map(([x, y], i) =>
          `<span class="onb-dot" style="left:${x}%;top:${y}%">${i + 1}</span>`).join('')}
      </div>
      <ol class="onb-items">
        ${s.items.map((item, i) => `<li><span class="onb-num">${i + 1}</span>${item}</li>`).join('')}
      </ol>`)
    .join('');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-card onb-card">
        <div class="row between modal-head">
          <strong>${t('onb.title')}</strong>
          <button id="onb-close" class="icon-btn" title="${t('common.close')}">✕</button>
        </div>
        <p class="muted">${t('onb.intro')}</p>
        ${sections}
      </div>
    </div>`;
}

export function openOnboarding(): void {
  if (!root) {
    root = document.createElement('div');
    root.id = 'onb-modal';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('modal-overlay') || target.closest('#onb-close')) {
        root!.innerHTML = '';
      }
    });
    onChange(() => {
      if (root!.innerHTML) render();
    });
  }
  render();
}
