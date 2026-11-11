import { describe, expect, it } from 'vitest';
import {
  ACTION_WIDTH,
  autoScrollSpeed,
  chipPosition,
  commitAt,
  dragIds,
  escapedList,
  holdBroken,
  HOLD_SLOP,
  lockAxis,
  MAX_DRAG,
  openWidth,
  rubberBand,
  SCROLL_MAX,
  swipeOffset,
  swipeRelease,
  SWIPE_SLOP,
  trayPlacement,
} from '@/lib/chat-gestures';

describe('Gestos de una fila de chat: eje y toque largo', () => {
  it('no decide el eje hasta pasar el umbral', () => {
    expect(lockAxis(3, 2)).toBeNull();
    expect(lockAxis(SWIPE_SLOP - 1, -(SWIPE_SLOP - 1))).toBeNull();
  });

  it('gana el eje que más se movió, y en el empate es scroll', () => {
    expect(lockAxis(12, 4)).toBe('x');
    expect(lockAxis(-12, 4)).toBe('x');
    expect(lockAxis(4, 12)).toBe('y');
    expect(lockAxis(3, -20)).toBe('y');
    expect(lockAxis(10, 10)).toBe('y');
  });

  it('el toque largo aguanta un temblor y se rompe con movimiento', () => {
    expect(holdBroken(2, 2)).toBe(false);
    expect(holdBroken(HOLD_SLOP, 0)).toBe(false);
    expect(holdBroken(HOLD_SLOP, HOLD_SLOP)).toBe(true);
    expect(holdBroken(0, -9)).toBe(true);
  });
});

describe('Gestos de una fila de chat: deslizar', () => {
  const row = { width: 390, left: 2, right: 2 };

  it('la fila sigue al dedo hacia un lado con acciones, hasta su ancho', () => {
    expect(swipeOffset(0, row)).toBe(0);
    expect(swipeOffset(-120, row)).toBe(-120);
    expect(swipeOffset(200, row)).toBe(200);
    expect(swipeOffset(-900, row)).toBe(-390);
    expect(swipeOffset(900, row)).toBe(390);
  });

  it('hacia un lado sin acciones solo cede un poco (goma)', () => {
    const none = { width: 390, left: 0, right: 2 };
    const a = swipeOffset(-40, none);
    const b = swipeOffset(-400, none);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-40);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(-40);
    expect(swipeOffset(100, none)).toBe(100);
  });

  it('la goma crece cada vez menos y nunca pasa del tope', () => {
    expect(rubberBand(0, 40)).toBe(0);
    expect(rubberBand(-5, 40)).toBe(0);
    const steps = [10, 50, 200, 5000].map((v) => rubberBand(v, 40));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(steps[steps.length - 1]).toBeLessThan(40);
  });

  it('las acciones abiertas ocupan su ancho y dejan a la vista parte de la fila', () => {
    expect(openWidth(2, 390)).toBe(2 * ACTION_WIDTH);
    expect(openWidth(2, 160)).toBe(104);
    expect(openWidth(0, 390)).toBe(0);
  });

  it('el umbral para ejecutar está más allá de las acciones abiertas', () => {
    expect(commitAt(390, 2)).toBe(234);
    expect(commitAt(300, 2)).toBe(200);
    expect(commitAt(390, 2)).toBeGreaterThan(openWidth(2, 390));
  });

  it('soltar: poco vuelve, a mitad de camino queda abierto, hasta el fondo ejecuta', () => {
    expect(swipeRelease({ x: -20, width: 390, count: 2 })).toBe('close');
    expect(swipeRelease({ x: -75, width: 390, count: 2 })).toBe('close');
    expect(swipeRelease({ x: -76, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 150, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 233, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 234, width: 390, count: 2 })).toBe('commit');
    expect(swipeRelease({ x: -390, width: 390, count: 2 })).toBe('commit');
  });

  it('soltar: un envión hacia afuera abre, uno de vuelta cierra, y sin acciones siempre vuelve', () => {
    expect(swipeRelease({ x: -40, width: 390, count: 2, velocity: -0.9 })).toBe('open');
    expect(swipeRelease({ x: 40, width: 390, count: 2, velocity: 0.9 })).toBe('open');
    expect(swipeRelease({ x: -10, width: 390, count: 2, velocity: -0.9 })).toBe('close');
    expect(swipeRelease({ x: -150, width: 390, count: 2, velocity: 0.6 })).toBe('close');
    expect(swipeRelease({ x: 150, width: 390, count: 2, velocity: -0.6 })).toBe('close');
    expect(swipeRelease({ x: -300, width: 390, count: 0 })).toBe('close');
    expect(swipeRelease({ x: 0, width: 390, count: 2 })).toBe('close');
  });

  it('un deslizado con el mouse que sale de la lista pasa a ser un arrastre', () => {
    const list = { left: 240, top: 100, right: 600, bottom: 800 };
    expect(escapedList({ x: 300, y: 400 }, list)).toBe(false);
    expect(escapedList({ x: 232, y: 400 }, list)).toBe(false);
    expect(escapedList({ x: 200, y: 400 }, list)).toBe(true);
    expect(escapedList({ x: 640, y: 400 }, list)).toBe(true);
    expect(escapedList({ x: 300, y: 60 }, list)).toBe(true);
    expect(escapedList({ x: 300, y: 830 }, list)).toBe(true);
  });
});

describe('Gestos de una fila de chat: levantar y soltar', () => {
  const screen = { vw: 1280, vh: 800 };

  it('la ficha va abajo a la derecha del puntero: no tapa lo que hay debajo', () => {
    const p = chipPosition({ x: 100, y: 200, w: 160, h: 36, ...screen });
    expect(p.left).toBeGreaterThan(100);
    expect(p.top).toBeGreaterThan(200);
    // El punto bajo el puntero queda fuera de la ficha.
    expect(100 < p.left || 100 > p.left + 160 || 200 < p.top || 200 > p.top + 36).toBe(true);
  });

  it('cerca del borde derecho o de abajo, la ficha pasa al otro lado sin salirse', () => {
    const right = chipPosition({ x: 1270, y: 200, w: 160, h: 36, ...screen });
    expect(right.left + 160).toBeLessThanOrEqual(1270);
    const bottom = chipPosition({ x: 400, y: 790, w: 160, h: 36, ...screen });
    expect(bottom.top + 36).toBeLessThanOrEqual(790);
    const corner = chipPosition({ x: 2, y: 2, w: 160, h: 36, ...screen });
    expect(corner.left).toBeGreaterThanOrEqual(8);
    expect(corner.top).toBeGreaterThanOrEqual(8);
  });

  it('con el dedo la ficha va arriba (la mano tapa lo de abajo), salvo pegado al borde de arriba', () => {
    const p = chipPosition({ x: 200, y: 400, w: 160, h: 36, vw: 390, vh: 844, touch: true });
    expect(p.top + 36).toBeLessThan(400);
    const top = chipPosition({ x: 200, y: 20, w: 160, h: 36, vw: 390, vh: 844, touch: true });
    expect(top.top).toBeGreaterThan(20);
    const narrow = chipPosition({ x: 380, y: 400, w: 200, h: 36, vw: 390, vh: 844, touch: true });
    expect(narrow.left).toBeGreaterThanOrEqual(8);
    expect(narrow.left + 200).toBeLessThanOrEqual(390);
  });

  it('la lista corre cuando el puntero se acerca al borde, más rápido cuanto más cerca', () => {
    expect(autoScrollSpeed(400, 100, 700)).toBe(0);
    const nearTop = autoScrollSpeed(140, 100, 700);
    const atTop = autoScrollSpeed(102, 100, 700);
    expect(nearTop).toBeLessThan(0);
    expect(atTop).toBeLessThan(nearTop);
    expect(atTop).toBeGreaterThanOrEqual(-SCROLL_MAX);
    const nearBottom = autoScrollSpeed(660, 100, 700);
    const atBottom = autoScrollSpeed(699, 100, 700);
    expect(nearBottom).toBeGreaterThan(0);
    expect(atBottom).toBeGreaterThan(nearBottom);
    expect(atBottom).toBeLessThanOrEqual(SCROLL_MAX);
  });

  it('apenas pasado el borde sigue corriendo; lejos, o en una lista sin alto, no', () => {
    expect(autoScrollSpeed(90, 100, 700)).toBe(-SCROLL_MAX);
    expect(autoScrollSpeed(710, 100, 700)).toBe(SCROLL_MAX);
    expect(autoScrollSpeed(20, 100, 700)).toBe(0);
    expect(autoScrollSpeed(790, 100, 700)).toBe(0);
    expect(autoScrollSpeed(100, 100, 100)).toBe(0);
  });

  it('en una lista baja la franja se achica: el medio no corre', () => {
    expect(autoScrollSpeed(145, 100, 190)).toBe(0);
    expect(autoScrollSpeed(105, 100, 190)).toBeLessThan(0);
    expect(autoScrollSpeed(185, 100, 190)).toBeGreaterThan(0);
  });

  it('levantar un chat seleccionado lleva la selección, en el orden de la lista', () => {
    expect(dragIds('a', new Set())).toEqual(['a']);
    expect(dragIds('a', new Set(['b', 'c']))).toEqual(['a']);
    expect(dragIds('a', new Set(['a']))).toEqual(['a']);
    expect(dragIds('c', new Set(['c', 'a', 'x']), ['a', 'b', 'c'])).toEqual(['a', 'c', 'x']);
    const many = new Set(Array.from({ length: MAX_DRAG + 20 }, (_, i) => `t${i}`));
    expect(dragIds('t3', many)).toHaveLength(MAX_DRAG);
  });

  it('la bandeja de carpetas va al costado de la lista si entra, y si no abajo', () => {
    expect(trayPlacement({ left: 56, top: 120, right: 420, bottom: 800 }, 1280)).toEqual({ mode: 'side', left: 432, top: 128 });
    expect(trayPlacement({ left: 700, top: 0, right: 1270, bottom: 800 }, 1280)).toEqual({ mode: 'side', left: 424, top: 8 });
    expect(trayPlacement({ left: 0, top: 110, right: 390, bottom: 844 }, 390)).toEqual({ mode: 'bottom' });
  });
});
