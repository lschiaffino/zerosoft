import { describe, expect, it } from 'vitest';
import { isMenuKey, MENU_MARGIN, newWindowModifiers, nextIndex, placeMenu, placeSubmenu } from '@/lib/context-menu';

const inside = (b: { left: number; top: number }, w: number, h: number, vw: number, vh: number) =>
  b.left >= MENU_MARGIN && b.top >= MENU_MARGIN && b.left + w <= vw - MENU_MARGIN && b.top + h <= vh - MENU_MARGIN;

describe('Menú contextual: dónde se abre', () => {
  it('abajo a la derecha del puntero cuando entra', () => {
    expect(placeMenu({ x: 300, y: 200, w: 220, h: 300, vw: 1280, vh: 800 })).toMatchObject({ left: 300, top: 200 });
  });

  it('cerca del borde derecho se abre hacia la izquierda; cerca de abajo, hacia arriba', () => {
    const r = placeMenu({ x: 1200, y: 200, w: 220, h: 300, vw: 1280, vh: 800 });
    expect(r.left).toBe(980);
    const b = placeMenu({ x: 300, y: 700, w: 220, h: 300, vw: 1280, vh: 800 });
    expect(b.top).toBe(400);
    const corner = placeMenu({ x: 1279, y: 799, w: 220, h: 300, vw: 1280, vh: 800 });
    expect(corner).toMatchObject({ left: 1280 - 220 - MENU_MARGIN, top: 800 - 300 - MENU_MARGIN });
  });

  it('en un teléfono nunca sale de la ventana, ni con un menú más ancho que lo que queda a cada lado', () => {
    for (const x of [0, 5, 100, 195, 300, 385, 390]) {
      for (const y of [0, 50, 400, 840, 844]) {
        const b = placeMenu({ x, y, w: 240, h: 380, vw: 390, vh: 844 });
        expect(inside(b, 240, 380, 390, 844), JSON.stringify({ x, y, b })).toBe(true);
      }
    }
  });

  it('un menú más alto que la ventana se achica y queda arriba de todo', () => {
    const b = placeMenu({ x: 100, y: 300, w: 220, h: 900, vw: 1280, vh: 500 });
    expect(b.top).toBe(MENU_MARGIN);
    expect(b.maxHeight).toBe(500 - 2 * MENU_MARGIN);
  });

  it('el submenú va a la derecha del menú si entra, si no a la izquierda, alineado con su ítem', () => {
    const right = placeSubmenu({ parent: { left: 300, right: 520 }, item: { top: 380, bottom: 414 }, w: 200, h: 90, vw: 1280, vh: 800 });
    expect(right).toMatchObject({ side: 'right', left: 520, top: 380 });
    const left = placeSubmenu({ parent: { left: 1000, right: 1220 }, item: { top: 380, bottom: 414 }, w: 200, h: 90, vw: 1280, vh: 800 });
    expect(left).toMatchObject({ side: 'left', left: 800 });
    const low = placeSubmenu({ parent: { left: 300, right: 520 }, item: { top: 780, bottom: 790 }, w: 200, h: 90, vw: 1280, vh: 800 });
    expect(low.top).toBe(800 - 90 - MENU_MARGIN);
  });

  it('en un teléfono el submenú no entra a ningún lado: va debajo del ítem (que sigue a la vista), sin salir de la ventana', () => {
    const b = placeSubmenu({ parent: { left: 80, right: 320 }, item: { top: 300, bottom: 334 }, w: 200, h: 90, vw: 390, vh: 844 });
    expect(b.side).toBe('below');
    expect(b.top).toBe(334);
    expect(b.left).toBe(96);
    expect(inside(b, 200, 90, 390, 844)).toBe(true);
    // Pegado abajo de la pantalla: va arriba del ítem.
    const low = placeSubmenu({ parent: { left: 80, right: 320 }, item: { top: 780, bottom: 814 }, w: 200, h: 90, vw: 390, vh: 844 });
    expect(low.top + 90).toBeLessThanOrEqual(780);
    expect(inside(low, 200, 90, 390, 844)).toBe(true);
  });
});

describe('Menú contextual: teclado', () => {
  const none = [false, false, false, false];

  it('las flechas recorren los ítems y dan la vuelta', () => {
    expect(nextIndex(-1, 'ArrowDown', none)).toBe(0);
    expect(nextIndex(-1, 'ArrowUp', none)).toBe(3);
    expect(nextIndex(0, 'ArrowDown', none)).toBe(1);
    expect(nextIndex(3, 'ArrowDown', none)).toBe(0);
    expect(nextIndex(0, 'ArrowUp', none)).toBe(3);
    expect(nextIndex(2, 'Home', none)).toBe(0);
    expect(nextIndex(0, 'End', none)).toBe(3);
  });

  it('saltea los deshabilitados; sin ninguno habilitado no va a ninguna parte', () => {
    const d = [true, false, true, false];
    expect(nextIndex(-1, 'ArrowDown', d)).toBe(1);
    expect(nextIndex(1, 'ArrowDown', d)).toBe(3);
    expect(nextIndex(3, 'ArrowDown', d)).toBe(1);
    expect(nextIndex(-1, 'Home', d)).toBe(1);
    expect(nextIndex(-1, 'End', [false, true])).toBe(0);
    expect(nextIndex(0, 'ArrowDown', [true, true])).toBe(-1);
    expect(nextIndex(0, 'ArrowDown', [])).toBe(-1);
  });

  it('la tecla de menú y Shift+F10 lo abren; con otros modificadores no', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
    expect(isMenuKey({ key: 'F10', shiftKey: true, ctrlKey: true })).toBe(false);
    expect(isMenuKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('otra ventana en la app de escritorio: ⌘⌥ en Mac, Ctrl+Alt en Windows', () => {
    expect(newWindowModifiers('darwin')).toEqual({ metaKey: true, ctrlKey: false, altKey: true, shiftKey: false });
    expect(newWindowModifiers('win32')).toEqual({ metaKey: false, ctrlKey: true, altKey: true, shiftKey: false });
  });
});
