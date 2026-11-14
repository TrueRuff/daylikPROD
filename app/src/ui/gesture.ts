// защита от случайных срабатываний после перетаскивания и нажатия:
// браузер всё равно присылает click по месту отпускания, и он открывает
// карточку, ставит дело или меняет экран. Сторож один на экран — запоминает
// нажатие, замечает сдвиг указателя и глушит такой клик в capture-фазе.

const DRAG_PX = 8;        // сдвиг, после которого нажатие считается жестом
const CLICK_WINDOW_MS = 500; // сколько ждём click после отпускания
const LONG_PRESS_MS = 250; // удержание пальца, после которого стартует перетаскивание
export const ARM_MOVE_PX = 10;    // сдвиг до срабатывания — это скролл, не жест
const SCROLL_CLICK_MS = 300;      // клики столько мс после скролла считаются случайными

export { DRAG_PX };

// long-press для touch-перетаскивания: карточка с touch-action: pan-y листает
// список пальцем, а тащится только после удержания на месте. Возвращает
// отмену таймера; onArm срабатывает, если палец не сдвинулся и не ушёл в скролл
export function armOnLongPress(onArm: () => void): () => void {
  const t = setTimeout(onArm, LONG_PRESS_MS);
  return () => clearTimeout(t);
}

// случайный клик по кнопке при остановке скролла (большой палец на телефоне):
// гасим touch-клики, пришедшие вскоре после скролла. Колесо мыши не считаем —
// скролл и клик там раздельные намеренные действия
export function installScrollClickGuard(): void {
  let lastScrollAt = 0;
  let lastPointerType = 'mouse';
  document.addEventListener('pointerup', (e) => {
    lastPointerType = e.pointerType || 'mouse';
  }, true);
  document.addEventListener('scroll', () => {
    lastScrollAt = Date.now();
  }, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    if (lastPointerType !== 'touch') return;
    if (Date.now() - lastScrollAt >= SCROLL_CLICK_MS) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);
}

interface PointerMark {
  x: number;
  y: number;
  id: number;
}

export function installClickGuard(root: HTMLElement): void {
  let down: PointerMark | null = null; // координаты и pointerId текущего нажатия
  let moved = false; // указатель сдвинулся — это жест, а не тап
  let releasedAt = 0;

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      down = null;
      return;
    }
    if (down) {
      moved = true; // второй палец: жест двумя пальцами, не клик
      return;
    }
    down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    moved = false;
  }, true);

  root.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) moved = true;
  }, true);

  root.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    down = null;
    if (moved) releasedAt = Date.now();
  }, true);

  root.addEventListener('pointercancel', () => {
    down = null;
  }, true);

  root.addEventListener('click', (e) => {
    if (!moved || Date.now() - releasedAt > CLICK_WINDOW_MS) return;
    moved = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }, true);
}
