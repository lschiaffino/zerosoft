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
  swipeEnd,
  swipeMove,
  swipeOffset,
  swipeRelease,
  swipeStart,
  SWIPE_SLOP,
  trayPlacement,
  type SwipeEnd,
  type SwipeSide,
  type SwipeTrack,
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
  it('la fila sigue al dedo hacia su lado, hasta su ancho', () => {
    expect(swipeOffset({ base: 0, dx: 0, side: 'left', width: 390 })).toBe(0);
    expect(swipeOffset({ base: 0, dx: -120, side: 'left', width: 390 })).toBe(-120);
    expect(swipeOffset({ base: 0, dx: 200, side: 'right', width: 390 })).toBe(200);
    expect(swipeOffset({ base: 0, dx: -900, side: 'left', width: 390 })).toBe(-390);
    expect(swipeOffset({ base: 0, dx: 900, side: 'right', width: 390 })).toBe(390);
  });

  it('de vuelta se frena en 0: nunca cruza al otro lado', () => {
    expect(swipeOffset({ base: 0, dx: 50, side: 'left', width: 390 })).toBe(0);
    expect(swipeOffset({ base: 0, dx: -50, side: 'right', width: 390 })).toBe(0);
    expect(swipeOffset({ base: -152, dx: 100, side: 'left', width: 390 })).toBe(-52);
    expect(swipeOffset({ base: -152, dx: 400, side: 'left', width: 390 })).toBe(0);
    expect(swipeOffset({ base: 152, dx: -400, side: 'right', width: 390 })).toBe(0);
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

  it('soltar una fila cerrada: poco vuelve, a mitad de camino queda abierta, hasta el fondo ejecuta', () => {
    expect(swipeRelease({ x: -20, width: 390, count: 2 })).toBe('close');
    expect(swipeRelease({ x: -75, width: 390, count: 2 })).toBe('close');
    expect(swipeRelease({ x: -76, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 150, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 233, width: 390, count: 2 })).toBe('open');
    expect(swipeRelease({ x: 234, width: 390, count: 2 })).toBe('commit');
    expect(swipeRelease({ x: -390, width: 390, count: 2 })).toBe('commit');
  });

  it('soltar una fila cerrada: un envión hacia afuera abre, uno de vuelta cierra, y sin acciones siempre vuelve', () => {
    expect(swipeRelease({ x: -40, width: 390, count: 2, velocity: -0.9 })).toBe('open');
    expect(swipeRelease({ x: 40, width: 390, count: 2, velocity: 0.9 })).toBe('open');
    expect(swipeRelease({ x: -10, width: 390, count: 2, velocity: -0.9 })).toBe('close');
    expect(swipeRelease({ x: -150, width: 390, count: 2, velocity: 0.6 })).toBe('close');
    expect(swipeRelease({ x: 150, width: 390, count: 2, velocity: -0.6 })).toBe('close');
    expect(swipeRelease({ x: -300, width: 390, count: 0 })).toBe('close');
    expect(swipeRelease({ x: 0, width: 390, count: 2 })).toBe('close');
  });

  it('soltar una fila abierta: volver un 30% alcanza para cerrarla; menos, queda abierta', () => {
    const open = { width: 390, count: 2, from: 'open' as const };
    expect(swipeRelease({ ...open, x: -152 })).toBe('open');
    expect(swipeRelease({ ...open, x: -120 })).toBe('open');
    expect(swipeRelease({ ...open, x: -107 })).toBe('open');
    expect(swipeRelease({ ...open, x: -106 })).toBe('close');
    expect(swipeRelease({ ...open, x: -100 })).toBe('close');
    expect(swipeRelease({ ...open, x: 0 })).toBe('close');
    expect(swipeRelease({ ...open, x: 100 })).toBe('close');
    expect(swipeRelease({ ...open, x: 140 })).toBe('open');
    expect(swipeRelease({ ...open, x: -260 })).toBe('commit');
  });

  it('soltar una fila abierta: un envión de vuelta la cierra, pero un temblor no', () => {
    const open = { width: 390, count: 2, from: 'open' as const };
    expect(swipeRelease({ ...open, x: -130, velocity: 0.6 })).toBe('close');
    expect(swipeRelease({ ...open, x: -146, velocity: 0.9 })).toBe('open');
    expect(swipeRelease({ ...open, x: -80, velocity: -0.6 })).toBe('open');
    expect(swipeRelease({ ...open, x: 130, velocity: -0.6 })).toBe('close');
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

// ---------- Secuencias completas: el gesto entero, de apoyar a soltar ----------

const W = 390;
const COUNTS = { left: 2, right: 2 };
const OPEN = openWidth(2, W);

type Pt = [dx: number, dy: number, ms: number];

/** Recorre un gesto entero: puntos relativos al apoyo, con su tiempo. Devuelve cada corrimiento pintado y qué pasa al soltar. */
function play(path: Pt[], o: { open?: SwipeSide; upAfter?: number; counts?: { left: number; right: number } } = {}) {
  let t: SwipeTrack = swipeStart({ x: 200, y: 300, t: 0, width: W, counts: o.counts ?? COUNTS, open: o.open });
  const offsets: number[] = [t.offset];
  let last = 0;
  for (const [dx, dy, ms] of path) {
    t = swipeMove(t, { x: 200 + dx, y: 300 + dy, t: ms });
    offsets.push(t.offset);
    last = ms;
  }
  const end: SwipeEnd = swipeEnd(t, last + (o.upAfter ?? 8));
  return { t, offsets, end };
}

/** De `from` a `to` (px en x) en `ms`, con un punto cada 8 ms (un cuadro de 120 Hz). */
function glide(from: number, to: number, ms: number, t0 = 0): Pt[] {
  const steps = Math.max(1, Math.round(ms / 8));
  return Array.from({ length: steps }, (_, i) => {
    const k = (i + 1) / steps;
    return [from + (to - from) * k, 0, t0 + ms * k] as Pt;
  });
}

const neverRight = (xs: number[]) => xs.every((x) => x <= 0);
const neverLeft = (xs: number[]) => xs.every((x) => x >= 0);

describe('Deslizar: abierta a la izquierda, arrastrar a la derecha (el caso del dueño)', () => {
  it('arranca abierta del lado de sus acciones', () => {
    const t = swipeStart({ x: 0, y: 0, t: 0, width: W, counts: COUNTS, open: 'left' });
    expect(t.base).toBe(-OPEN);
    expect(t.offset).toBe(-OPEN);
    expect(t.side).toBe('left');
  });

  it('lento y lejos: se frena en 0, nunca muestra el otro lado, y al soltar se cierra', () => {
    const r = play(glide(0, 320, 600), { open: 'left' });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.offsets.at(-1)).toBe(0);
    expect(r.t.side).toBe('left');
    expect(r.end).toBe('close');
  });

  it('rápido y lejos (un envión): se cierra sin pasar al otro lado', () => {
    const r = play(glide(0, 260, 80), { open: 'left' });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('hasta el borde de la pantalla y un rato quieto: igual se cierra', () => {
    const r = play([...glide(0, 400, 300), [400, 0, 900]], { open: 'left', upAfter: 400 });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('pasa del 0 y vuelve un poco en el mismo gesto: sigue en 0 mientras el dedo esté pasado', () => {
    const r = play([...glide(0, 250, 200), ...glide(250, 170, 200, 200)], { open: 'left' });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.offsets.at(-1)).toBe(0);
    expect(r.end).toBe('close');
  });

  it('pasa del 0 y vuelve del todo: la fila acompaña de nuevo hacia su lado', () => {
    const r = play([...glide(0, 250, 200), ...glide(250, 0, 300, 200)], { open: 'left', upAfter: 150 });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.offsets.at(-1)).toBeLessThan(-OPEN + 20);
    expect(r.end).toBe('open');
  });

  it('un poco de vuelta (menos del 30%) y soltar despacio: queda abierta', () => {
    const r = play(glide(0, 30, 300), { open: 'left', upAfter: 150 });
    expect(r.end).toBe('open');
  });

  it('un tercio de vuelta y soltar despacio: se cierra', () => {
    const r = play(glide(0, 60, 400), { open: 'left', upAfter: 150 });
    expect(r.end).toBe('close');
  });

  it('un toquecito de vuelta con envión: se cierra', () => {
    const r = play(glide(0, 34, 40), { open: 'left' });
    expect(r.end).toBe('close');
  });

  it('un envión hacia afuera la deja abierta; arrastrar hasta el fondo ejecuta', () => {
    expect(play(glide(0, -40, 60), { open: 'left' }).end).toBe('open');
    const far = play(glide(0, -160, 300), { open: 'left' });
    expect(far.end).toBe('commit');
    expect(neverRight(far.offsets)).toBe(true);
  });

  it('temblores alrededor de donde está: no la cierran', () => {
    const jitter: Pt[] = Array.from({ length: 30 }, (_, i) => [(i % 2 ? 1 : -1) * 10, 2, (i + 1) * 8]);
    const r = play(jitter, { open: 'left' });
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.end).toBe('open');
  });

  it('arrastre que empieza vertical (scroll): la fila no se mueve y el gesto no es deslizar', () => {
    const r = play([[2, 12, 8], [40, 60, 40], [200, 80, 120]], { open: 'left' });
    expect(r.t.axis).toBe('y');
    expect(r.offsets.every((x) => x === -OPEN)).toBe(true);
    expect(r.end).toBe('close');
  });
});

describe('Deslizar: abierta a la derecha, arrastrar a la izquierda', () => {
  it('lento y lejos: se frena en 0 y se cierra', () => {
    const r = play(glide(0, -320, 600), { open: 'right' });
    expect(neverLeft(r.offsets)).toBe(true);
    expect(r.offsets.at(-1)).toBe(0);
    expect(r.end).toBe('close');
  });

  it('rápido: se cierra sin mostrar la izquierda', () => {
    const r = play(glide(0, -200, 60), { open: 'right' });
    expect(neverLeft(r.offsets)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('poco de vuelta: queda abierta; más allá del 30%: se cierra', () => {
    expect(play(glide(0, -25, 300), { open: 'right', upAfter: 150 }).end).toBe('open');
    expect(play(glide(0, -70, 300), { open: 'right', upAfter: 150 }).end).toBe('close');
  });
});

describe('Deslizar desde cerrada', () => {
  it('izquierda y después derecha en el mismo gesto: no cruza, vuelve a cerrada', () => {
    const r = play([...glide(0, -100, 200), ...glide(-100, 300, 400, 200)]);
    expect(r.t.side).toBe('left');
    expect(neverRight(r.offsets)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('derecha y después izquierda en el mismo gesto: no cruza', () => {
    const r = play([...glide(0, 120, 200), ...glide(120, -300, 300, 200)]);
    expect(r.t.side).toBe('right');
    expect(neverLeft(r.offsets)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('temblor alrededor del 0: nada se abre', () => {
    const jitter: Pt[] = Array.from({ length: 40 }, (_, i) => [(i % 2 ? 1 : -1) * 11, 0, (i + 1) * 8]);
    const r = play(jitter);
    expect(r.offsets.every((x) => Math.abs(x) <= 3)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('un envión corto hacia afuera abre; uno de pocos px no', () => {
    expect(play(glide(0, -40, 40)).end).toBe('open');
    expect(play(glide(0, 40, 40)).end).toBe('open');
    expect(play(glide(0, -14, 16)).end).toBe('close');
  });

  it('despacio: pasada la mitad de las acciones abre, antes no', () => {
    expect(play(glide(0, -(OPEN / 2 + SWIPE_SLOP + 4), 500), { upAfter: 150 }).end).toBe('open');
    expect(play(glide(0, -(OPEN / 2 + SWIPE_SLOP - 6), 500), { upAfter: 150 }).end).toBe('close');
  });

  it('afuera y un envión de vuelta: se cierra', () => {
    const r = play([...glide(0, -160, 300), ...glide(-160, -110, 40, 300)]);
    expect(r.end).toBe('close');
  });

  it('hasta el fondo ejecuta la principal', () => {
    expect(play(glide(0, -300, 300)).end).toBe('commit');
    expect(play(glide(0, 300, 300)).end).toBe('commit');
  });

  it('arrastre que empieza vertical: no se desliza aunque después vaya de costado', () => {
    const r = play([[1, 10, 8], [3, 30, 16], [150, 40, 80]]);
    expect(r.t.axis).toBe('y');
    expect(r.offsets.every((x) => x === 0)).toBe(true);
  });

  it('diagonal mayormente vertical gana el scroll; mayormente horizontal, el deslizado', () => {
    expect(play([[6, 9, 8]]).t.axis).toBe('y');
    expect(play([[9, 6, 8]]).t.axis).toBe('x');
  });

  it('el eje no se decide antes del umbral', () => {
    const r = play([[3, 2, 8], [-4, 3, 16], [5, -5, 24]]);
    expect(r.t.axis).toBeNull();
    expect(r.end).toBe('close');
  });

  it('el lado sin acciones no se mueve', () => {
    const r = play(glide(0, -200, 200), { counts: { left: 0, right: 2 } });
    expect(r.offsets.every((x) => x === 0)).toBe(true);
    expect(r.end).toBe('close');
  });

  it('la fila no salta al decidir el eje', () => {
    const r = play(glide(0, -40, 80));
    const firstMoved = r.offsets.find((x) => x !== 0) ?? 0;
    expect(Math.abs(firstMoved)).toBeLessThanOrEqual(6);
  });

  it('quedarse quieto antes de soltar anula el envión', () => {
    expect(play(glide(0, -40, 40), { upAfter: 8 }).end).toBe('open');
    expect(play(glide(0, -40, 40), { upAfter: 200 }).end).toBe('close');
  });
});

describe('Deslizar: varias filas', () => {
  it('una fila abierta no cambia cómo arranca otra', () => {
    const a = swipeStart({ x: 0, y: 0, t: 0, width: W, counts: COUNTS, open: 'left' });
    const b = swipeStart({ x: 0, y: 0, t: 0, width: W, counts: COUNTS });
    expect(a.base).toBe(-OPEN);
    expect(b.base).toBe(0);
    expect(b.side).toBeNull();
  });

  it('abierta de un lado que ya no tiene acciones: arranca cerrada', () => {
    const t = swipeStart({ x: 0, y: 0, t: 0, width: W, counts: { left: 0, right: 2 }, open: 'left' });
    expect(t.base).toBe(0);
    expect(t.side).toBeNull();
  });
});

describe('Deslizar: miles de gestos al azar', () => {
  // Generador con semilla: el mismo resultado en cada corrida.
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  it('nunca cruza al otro lado, nunca pasa del ancho, y soltar en 0 siempre cierra', () => {
    let crossings = 0;
    for (let n = 0; n < 3000; n++) {
      const open = ([undefined, 'left', 'right'] as const)[Math.floor(rand() * 3)];
      const path: Pt[] = [];
      let x = 0;
      let y = 0;
      let ms = 0;
      for (let i = 0, len = 3 + Math.floor(rand() * 40); i < len; i++) {
        x += (rand() - 0.5) * 120;
        y += (rand() - 0.5) * (rand() < 0.2 ? 40 : 6);
        ms += 4 + Math.floor(rand() * 30);
        path.push([x, y, ms]);
      }
      const r = play(path, { open, upAfter: Math.floor(rand() * 150) });
      const side = r.t.side;
      for (const off of r.offsets) {
        if (Math.abs(off) > W) crossings++;
        if (side === 'left' && off > 0) crossings++;
        if (side === 'right' && off < 0) crossings++;
      }
      if (r.t.offset === 0) expect(r.end).toBe('close');
      if (r.end === 'commit') expect(Math.abs(r.t.offset)).toBeGreaterThanOrEqual(commitAt(W, 2));
      if (open) expect(side).toBe(open);
    }
    expect(crossings).toBe(0);
  });
});
