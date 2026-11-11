import { describe, expect, it } from 'vitest';
import { PANEL_BIG_STEP, PANEL_STEP, clampWidth, dragWidth, panelMax, resizeByKey } from '@/lib/panel-resize';
import { INBOX_LAYOUT, LINES_PANELS, defaultListWidth, linesPanelMode, linesPanelsKey, linesPanelsScript, parseSavedPanels, resolveLinesPanels } from '@/lib/groups-panels';

describe('divisor de paneles: cuentas', () => {
  it('clampWidth redondea y respeta mínimo y máximo', () => {
    expect(clampWidth(350.6, 300, 600)).toBe(351);
    expect(clampWidth(10, 300, 600)).toBe(300);
    expect(clampWidth(9999, 300, 600)).toBe(600);
    expect(clampWidth(Number.NaN, 300, 600)).toBe(300);
    // Un máximo por debajo del mínimo no deja el panel más angosto que el mínimo.
    expect(clampWidth(500, 300, 200)).toBe(300);
  });

  it('panelMax: el tope propio o lo que deja libre el resto', () => {
    expect(panelMax(2000, 680, 300, 600)).toBe(600);
    expect(panelMax(1200, 680, 300, 600)).toBe(520);
    expect(panelMax(700, 680, 300, 600)).toBe(300);
  });

  it('dragWidth: el panel de la izquierda crece hacia la derecha y el de la derecha, hacia la izquierda', () => {
    expect(dragWidth(340, 60, 'start', 300, 600)).toBe(400);
    expect(dragWidth(340, -60, 'start', 300, 600)).toBe(300);
    expect(dragWidth(340, -60, 'end', 280, 520)).toBe(400);
    expect(dragWidth(340, 500, 'end', 280, 520)).toBe(280);
  });

  it('teclado: flechas, Shift, Inicio, Fin y Enter', () => {
    const base = { value: 340, min: 300, max: 600, side: 'start' as const };
    expect(resizeByKey('ArrowRight', base)).toEqual({ type: 'set', value: 340 + PANEL_STEP });
    expect(resizeByKey('ArrowLeft', base)).toEqual({ type: 'set', value: 340 - PANEL_STEP });
    expect(resizeByKey('ArrowRight', { ...base, shift: true })).toEqual({ type: 'set', value: 340 + PANEL_BIG_STEP });
    expect(resizeByKey('ArrowLeft', { ...base, shift: true })).toEqual({ type: 'set', value: 300 });
    expect(resizeByKey('Home', base)).toEqual({ type: 'set', value: 300 });
    expect(resizeByKey('End', base)).toEqual({ type: 'set', value: 600 });
    expect(resizeByKey('Enter', base)).toEqual({ type: 'reset' });
    expect(resizeByKey('a', base)).toBeNull();
    expect(resizeByKey('ArrowUp', base)).toBeNull();
    // Panel a la derecha: la flecha izquierda lo agranda.
    expect(resizeByKey('ArrowLeft', { ...base, side: 'end' })).toEqual({ type: 'set', value: 340 + PANEL_STEP });
    expect(resizeByKey('ArrowRight', { ...base, side: 'end' })).toEqual({ type: 'set', value: 340 - PANEL_STEP });
  });
});

describe('paneles de la bandeja de Lines', () => {
  const { list: L, details: D, conversationMin } = LINES_PANELS;

  it('modo según el ancho de la ventana (los cortes del CSS)', () => {
    expect(linesPanelMode(1440)).toBe('three');
    expect(linesPanelMode(1439)).toBe('two');
    expect(linesPanelMode(1024)).toBe('two');
    expect(linesPanelMode(1023)).toBe('one');
    expect(linesPanelMode(390)).toBe('one');
  });

  it('ancho por defecto de la lista: el clamp del CSS', () => {
    expect(defaultListWidth(1000, 'three')).toBe(340);
    expect(defaultListWidth(1300, 'three')).toBe(390);
    expect(defaultListWidth(2400, 'three')).toBe(460);
    expect(defaultListWidth(800, 'two')).toBe(320);
    expect(defaultListWidth(1100, 'two')).toBe(374);
    expect(defaultListWidth(1400, 'two')).toBe(420);
  });

  it('sin nada guardado manda el CSS', () => {
    const r = resolveLinesPanels({}, 1300, 'three');
    expect(r.list).toEqual({ value: 390, min: L.min, max: 600, custom: false });
    expect(r.details).toEqual({ value: D.fallback, min: D.min, max: 510, custom: false });
  });

  it('lo guardado se usa y se acomoda a la ventana', () => {
    const wide = resolveLinesPanels({ list: 560, details: 500 }, 2000, 'three');
    expect(wide.list).toMatchObject({ value: 560, custom: true });
    expect(wide.details).toMatchObject({ value: 500, custom: true });

    // La misma persona en una ventana más chica: la conversación conserva su mínimo.
    const small = resolveLinesPanels({ list: 560, details: 500 }, 1200, 'three');
    expect(small.list).toMatchObject({ value: 520, max: 520 });
    expect(small.details).toMatchObject({ value: D.min, max: D.min });
    expect(1200 - small.list!.value - small.details!.value).toBeGreaterThanOrEqual(conversationMin);
  });

  it('una lista ancha achica los detalles por defecto', () => {
    const r = resolveLinesPanels({ list: 520 }, 1200, 'three');
    expect(r.details).toEqual({ value: D.min, min: D.min, max: D.min, custom: true });
  });

  it('dos columnas: solo la lista; una columna: nada', () => {
    const two = resolveLinesPanels({ list: 600, details: 500 }, 900, 'two');
    expect(two.list).toMatchObject({ value: 500, max: 500, custom: true });
    expect(two.details).toBeNull();
    expect(resolveLinesPanels({ list: 600, details: 500 }, 390, 'one')).toEqual({ list: null, details: null });
  });

  it('lo guardado: se descarta lo que no sea un número válido', () => {
    expect(parseSavedPanels(null)).toEqual({});
    expect(parseSavedPanels('no es json')).toEqual({});
    expect(parseSavedPanels('null')).toEqual({});
    expect(parseSavedPanels('{"list":412.4,"details":"x"}')).toEqual({ list: 412 });
    expect(parseSavedPanels('{"list":-5,"details":300}')).toEqual({ details: 300 });
  });

  it('el script de antes del pintado usa la clave de la persona y no deja cerrar la etiqueta', () => {
    expect(linesPanelsKey('u1')).toBe('zs-lines-panels:u1');
    const js = linesPanelsScript('u1</script>');
    expect(js).not.toContain('</script>');
    expect(js).toContain('--gr-list-w');
    expect(js).toContain('--gr-details-w');
    expect(() => new Function(js)).not.toThrow();
  });
});

describe('Inbox: anchos de paneles', () => {
  it('tres columnas solo con la info abierta y desde 1366', () => {
    expect(linesPanelMode(1400, INBOX_LAYOUT, true)).toBe('three');
    expect(linesPanelMode(1400, INBOX_LAYOUT, false)).toBe('two');
    expect(linesPanelMode(1365, INBOX_LAYOUT, true)).toBe('two');
    expect(linesPanelMode(1023, INBOX_LAYOUT, false)).toBe('one');
  });
  it('los anchos por defecto son los del CSS de Inbox', () => {
    expect(defaultListWidth(1200, 'two', INBOX_LAYOUT)).toBe(360);
    expect(defaultListWidth(1500, 'three', INBOX_LAYOUT)).toBe(420);
    const r = resolveLinesPanels({}, 1500, 'three', INBOX_LAYOUT);
    expect(r.details?.value).toBe(390);
    expect(r.details?.custom).toBe(false);
  });
  it('lo guardado se acomoda a la ventana y en una columna no hay divisores', () => {
    const r = resolveLinesPanels({ list: 900 }, 1100, 'two', INBOX_LAYOUT);
    expect(r.list?.value).toBe(600);
    expect(r.details).toBeNull();
    expect(resolveLinesPanels({ list: 400 }, 800, 'one', INBOX_LAYOUT)).toEqual({ list: null, details: null });
  });
});
