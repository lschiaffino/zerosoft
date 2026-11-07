/**
 * Lo que corre en el navegador: pone en marcha una figura sobre su <pre>. Se
 * detiene del todo fuera de pantalla y con la pestaña oculta, respeta el tope de
 * cuadros de la figura y con movimiento reducido deja el cuadro quieto (si se
 * puede arrastrar, se sigue pudiendo). Arranca desde `still`, el cuadro que ya
 * vino del servidor: no hay salto al empezar.
 */

import { CHAR_W, Cells, LINE_H, type Figure, type FigureInput } from './engine';

export function runFigure(box: HTMLElement, pre: HTMLPreElement, figure: Figure): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const input: FigureInput = { dragX: 0, dragY: 0, x: null, y: null };
  const interval = 1000 / figure.fps;
  let cells = new Cells(figure.cols, figure.rows);
  let time = figure.still;
  let visible = true;
  let raf = 0;
  let lastTick = 0;
  let lastDraw = 0;
  let shown = pre.textContent ?? '';
  let lastScroll = -Infinity;
  const yieldToScroll = window.matchMedia('(pointer: coarse), (max-width: 860px)').matches;
  const onScroll = () => {
    lastScroll = performance.now();
  };

  const paint = () => {
    let text: string;
    if (figure.text) {
      text = figure.text(time, input);
    } else {
      figure.draw(cells, time, input);
      text = cells.text();
    }
    // Muchas figuras pasan cuadros sin cambios: no tocar el DOM ahorra el trazado.
    if (text !== shown) {
      pre.textContent = text;
      shown = text;
    }
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    // Después de una pausa larga sigue donde estaba.
    time += Math.min(now - lastTick, 100) / 1000;
    lastTick = now;
    if (now - lastDraw < interval - 2) return;
    // En el teléfono, mientras la página se desliza, primero el scroll: el cuadro espera.
    if (yieldToScroll && now - lastScroll < 140) return;
    lastDraw = now;
    paint();
  };

  const sync = () => {
    const shouldRun = visible && !document.hidden && !reduced.matches;
    if (shouldRun && !raf) {
      lastTick = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    sync();
  });
  io.observe(box);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);

  const cleanups: (() => void)[] = [];

  if (yieldToScroll) {
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', onScroll));
  }

  // Las que ocupan lo que les den: tantas celdas como entren con la letra del CSS.
  if (figure.fluid) {
    const resize = () => {
      const size = parseFloat(getComputedStyle(pre).fontSize) || 12;
      const cols = Math.max(1, Math.ceil(box.clientWidth / (size * CHAR_W)));
      const rows = Math.max(1, Math.ceil(box.clientHeight / (size * LINE_H)));
      if (cols !== cells.cols || rows !== cells.rows) {
        cells = new Cells(cols, rows);
        paint();
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    cleanups.push(() => ro.disconnect());
    resize();

    // El puntero se escucha en la sección que la contiene: la figura va detrás del texto.
    // En táctil no hay puntero que seguir.
    if (window.matchMedia('(pointer: fine)').matches) {
      const host = box.parentElement ?? box;
      const move = (e: PointerEvent) => {
        const rect = box.getBoundingClientRect();
        const size = parseFloat(getComputedStyle(pre).fontSize) || 12;
        input.x = (e.clientX - rect.left) / (size * CHAR_W);
        input.y = (e.clientY - rect.top) / (size * LINE_H);
      };
      const leave = () => {
        input.x = null;
        input.y = null;
      };
      host.addEventListener('pointermove', move, { passive: true });
      host.addEventListener('pointerleave', leave);
      cleanups.push(() => {
        host.removeEventListener('pointermove', move);
        host.removeEventListener('pointerleave', leave);
      });
    }
  }

  // Arrastrar gira la figura. El CSS deja touch-action: pan-y: en el teléfono
  // lo horizontal gira y lo vertical sigue moviendo la página.
  if (figure.draggable) {
    let start: { x: number; y: number; dragX: number; dragY: number } | null = null;
    const down = (e: PointerEvent) => {
      start = { x: e.clientX, y: e.clientY, dragX: input.dragX, dragY: input.dragY };
      box.setPointerCapture(e.pointerId);
      box.dataset.dragging = '';
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      input.dragX = start.dragX + (e.clientX - start.x);
      input.dragY = start.dragY + (e.clientY - start.y);
      paint();
    };
    const up = () => {
      start = null;
      delete box.dataset.dragging;
    };
    box.addEventListener('pointerdown', down);
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    cleanups.push(() => {
      box.removeEventListener('pointerdown', down);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
    });
  }

  sync();

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    reduced.removeEventListener('change', sync);
    cleanups.forEach((fn) => fn());
  };
}
