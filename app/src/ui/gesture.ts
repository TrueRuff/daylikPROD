// защита от случайных срабатываний после перетаскивания и нажатия:
// браузер всё равно присылает click по месту отпускания, и он открывает
// карточку, ставит дело или меняет экран. Сторож один на экран — запоминает
// нажатие, замечает сдвиг указателя и глушит такой клик в capture-фазе.

const DRAG_PX = 8;        // сдвиг, после которого нажатие считается жестом
const CLICK_WINDOW_MS = 500; // сколько ждём click после отпускания

export { DRAG_PX };

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
