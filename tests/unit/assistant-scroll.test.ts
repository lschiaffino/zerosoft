import { describe, expect, it } from 'vitest';
import { INITIAL_ROWS, STEP_ROWS, followAfterScroll, followDecision, initialRows, isNearBottom, nextReveal } from '@/lib/assistant/scroll';
import { renderAssistantMarkdown } from '@/lib/assistant/markdown';

/** Una sola barra de scroll en el asistente: listas y tablas largas se abren en el lugar; la charla sigue lo nuevo solo si estabas al final. */

describe('renglones de una lista larga', () => {
  it('las cortas se ven enteras; esconder 1 o 2 renglones no vale un botón', () => {
    expect(initialRows(3)).toBe(3);
    expect(initialRows(INITIAL_ROWS)).toBe(INITIAL_ROWS);
    expect(initialRows(INITIAL_ROWS + 2)).toBe(INITIAL_ROWS + 2);
    expect(nextReveal(10, initialRows(10))).toBeNull();
  });

  it('27 carpetas: se ven 8 y "Mostrar las 27" abre todas de una', () => {
    expect(initialRows(27)).toBe(INITIAL_ROWS);
    expect(nextReveal(27, 8)).toEqual({ kind: 'all', total: 27, to: 27 });
    expect(nextReveal(27, 27)).toBeNull();
  });

  it('muchas: "Mostrar 100 más" de a 100, y el último paso es "Mostrar las N"', () => {
    const total = 313;
    let shown = initialRows(total);
    const steps: string[] = [];
    for (let r = nextReveal(total, shown); r; r = nextReveal(total, shown)) {
      steps.push(r.kind === 'all' ? `all ${r.total}` : `more ${r.count}`);
      shown = r.to;
    }
    expect(steps).toEqual([`more ${STEP_ROWS}`, `more ${STEP_ROWS}`, `more ${STEP_ROWS}`, 'all 313']);
    expect(shown).toBe(total);
  });

  it('108 no encontrados: 8 y después las 108 (lo que falta entra en un paso)', () => {
    expect(nextReveal(108, initialRows(108))).toEqual({ kind: 'all', total: 108, to: 108 });
  });
});

describe('seguir lo que llega', () => {
  it('cerca del final es "al final" (80 px de margen)', () => {
    expect(isNearBottom({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 960 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 2000, scrollTop: 900, clientHeight: 960 })).toBe(false);
  });

  it('al final: baja con lo nuevo y no muestra "Ir al final"', () => {
    expect(followDecision({ following: true, holding: false, nearBottom: true })).toEqual({ action: 'follow', jump: false });
  });

  it('subió a leer: no lo mueve y aparece "Ir al final"', () => {
    expect(followDecision({ following: false, holding: false, nearBottom: false })).toEqual({ action: 'stay', jump: true });
  });

  it('subir un poco mientras llega texto deja de seguir, aunque siga cerca del final; bajar al final vuelve a seguir', () => {
    expect(followAfterScroll({ scrolledUp: true, nearBottom: true })).toBe(false);
    expect(followAfterScroll({ scrolledUp: false, nearBottom: true })).toBe(true);
    expect(followAfterScroll({ scrolledUp: false, nearBottom: false })).toBe(false);
  });

  it('abrir una lista no salta, aunque estuviera al final', () => {
    expect(followDecision({ following: true, holding: true, nearBottom: false })).toEqual({ action: 'stay', jump: true });
    expect(followDecision({ following: true, holding: true, nearBottom: true })).toEqual({ action: 'stay', jump: false });
  });
});

describe('tablas largas en la respuesta', () => {
  const table = (n: number) => `| Carpeta | Chats |\n| --- | --- |\n${Array.from({ length: n }, (_, i) => `| F${i} | ${i} |`).join('\n')}`;
  const label = (r: { kind: string; total?: number; count?: number }) => (r.kind === 'all' ? `Show all ${r.total}` : `Show ${r.count} more`);

  it('sin opciones se ve entera (como antes)', () => {
    const html = renderAssistantMarkdown(table(27));
    expect(html.match(/<tr>/g)).toHaveLength(28);
    expect(html).not.toContain('data-rows-more');
  });

  it('se ven 8 filas y el botón va en un caption abajo; abierta, todas', () => {
    const html = renderAssistantMarkdown(table(27), { rows: { shown: {}, label } });
    expect(html.match(/<tr>/g)).toHaveLength(9);
    expect(html).toContain('<caption class="asst-table-more"><button type="button" class="btn btn-ghost btn-sm asst-show-rows" data-rows-more="t0" data-to="27">Show all 27</button></caption>');
    const open = renderAssistantMarkdown(table(27), { rows: { shown: { t0: 27 }, label } });
    expect(open.match(/<tr>/g)).toHaveLength(28);
    expect(open).not.toContain('data-rows-more');
  });

  it('mientras se escribe no se achica: de entrada nunca más de 8, y al terminar 10 se ven enteras', () => {
    const writing = renderAssistantMarkdown(table(10), { cursor: true, rows: { shown: {}, label } });
    expect(writing.match(/<tr>/g)).toHaveLength(9);
    const done = renderAssistantMarkdown(table(10), { rows: { shown: {}, label } });
    expect(done.match(/<tr>/g)).toHaveLength(11);
  });

  it('los números no cambian al abrir: una sublista escondida ya tiene el suyo', () => {
    const a = Array.from({ length: 12 }, (_, i) => (i === 10 ? `- A${i}\n  - sub 1\n  - sub 2` : `- A${i}`)).join('\n');
    const b = Array.from({ length: 12 }, (_, i) => `1. B${i}`).join('\n');
    const src = `${a}\n\ntext\n\n${b}`;
    const closed = renderAssistantMarkdown(src, { rows: { shown: {}, label } });
    expect(closed).toContain('<ol data-rows="l2">');
    const open = renderAssistantMarkdown(src, { rows: { shown: { l0: 12 }, label } });
    expect(open).toContain('<ul data-rows="l1">');
    expect(open).toContain('<ol data-rows="l2">');
    expect(open).toContain('data-rows-more="l2"');
  });

  it('cada tabla del mensaje lleva su número; el cursor sigue en la última celda', () => {
    const html = renderAssistantMarkdown(`${table(3)}\n\n${table(20)}`, { cursor: true, rows: { shown: {}, label } });
    expect(html).toContain('data-rows-more="t1"');
    expect(html).not.toContain('data-rows-more="t0"');
    expect(html).toMatch(/<span class="asst-cursor" aria-hidden="true"><\/span><\/td><\/tr><\/tbody><\/table><\/div>$/);
  });

  it('lista larga (no encontrados): 8 ítems y el botón abajo; el cursor sigue en el último ítem', () => {
    const list = Array.from({ length: 30 }, (_, i) => `- Chat ${i} in *F${i % 3}*`).join('\n');
    const html = renderAssistantMarkdown(`**Not found (30):**\n${list}`, { cursor: true, rows: { shown: {}, label } });
    expect(html.match(/<li>/g)).toHaveLength(8);
    expect(html).toMatch(/<span class="asst-cursor" aria-hidden="true"><\/span><\/em><\/li>\n<\/ul>\n<div class="asst-list-more"><button [^>]*data-rows-more="l0" data-to="30">Show all 30<\/button><\/div>$/);
    const open = renderAssistantMarkdown(`**Not found (30):**\n${list}`, { rows: { shown: { l0: 30 }, label } });
    expect(open.match(/<li>/g)).toHaveLength(30);
    expect(open).not.toContain('asst-list-more');
  });
});
