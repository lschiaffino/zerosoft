import { describe, expect, it } from 'vitest';
import { applyColorMatrix, compose, contrast, FILTER_MATRIX, FILTERS, isFilter, saturate, type FilterId } from '@/lib/wa-image-filters';
import { blurDabs, fromView, hasBlur, hasEdits, isLight, needsRender, NO_EDITS, outputName, rectFromView, renderEdits, rotateLeft, sendScale, toView, viewSize, type Ctx2D, type Edits, type Rotation } from '@/lib/wa-image-edit';

const natural = { w: 400, h: 300 };
const edits = (p: Partial<Edits> = {}): Edits => ({ ...NO_EDITS, ...p });

describe('wa-image-edit: coordenadas', () => {
  it('toView y fromView son inversos con cada rotación y con recorte', () => {
    for (const rotate of [0, 90, 180, 270] as Rotation[]) {
      const e = edits({ rotate, crop: { x: 50, y: 20, w: 200, h: 150 } });
      for (const p of [{ x: 50, y: 20 }, { x: 120, y: 90 }, { x: 249, y: 169 }]) {
        const back = fromView(toView(p, e, natural), e, natural);
        expect(back.x).toBeCloseTo(p.x);
        expect(back.y).toBeCloseTo(p.y);
      }
    }
  });

  it('rotar 90 pone la esquina de arriba a la izquierda arriba a la derecha', () => {
    const e = edits({ rotate: 90 });
    expect(toView({ x: 0, y: 0 }, e, natural)).toEqual({ x: 300, y: 0 });
    expect(viewSize(e, natural)).toEqual({ w: 300, h: 400 });
  });

  it('un rectángulo de lo que se ve vuelve a la original derecho', () => {
    const e = edits({ rotate: 270 });
    const r = rectFromView({ x: 0, y: 0, w: 300, h: 400 }, e, natural);
    expect(r).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('rotar a la izquierda da la vuelta', () => {
    expect(rotateLeft(0)).toBe(270);
    expect(rotateLeft(270)).toBe(180);
    expect(rotateLeft(90)).toBe(0);
  });

  it('el recorte no se sale de la foto', () => {
    const e = edits({ crop: { x: 350, y: 250, w: 500, h: 500 } });
    expect(viewSize(e, natural)).toEqual({ w: 50, h: 50 });
  });
});

describe('wa-image-edit: cuándo dibujar de nuevo', () => {
  it('sin cambios y chica sale como está; grande y sin HD se achica; con HD no', () => {
    const jpg = { type: 'image/jpeg', size: 200_000 };
    expect(needsRender(jpg, { w: 800, h: 600 }, NO_EDITS, false)).toBe(false);
    expect(needsRender(jpg, { w: 4000, h: 3000 }, NO_EDITS, false)).toBe(true);
    expect(needsRender({ type: 'image/jpeg', size: 3_000_000 }, { w: 1200, h: 900 }, NO_EDITS, false)).toBe(true);
    expect(needsRender(jpg, { w: 4000, h: 3000 }, NO_EDITS, true)).toBe(false);
  });

  it('con cambios siempre; un GIF o un video nunca', () => {
    const e = edits({ strokes: [{ color: '#f00', width: 4, points: [1, 1, 2, 2] }] });
    expect(needsRender({ type: 'image/png', size: 10 }, { w: 10, h: 10 }, e, true)).toBe(true);
    expect(needsRender({ type: 'image/gif', size: 10 }, { w: 10, h: 10 }, e, true)).toBe(false);
    expect(needsRender({ type: 'video/mp4', size: 10 }, null, e, false)).toBe(false);
  });

  it('un texto vacío no cuenta como cambio', () => {
    expect(hasEdits(edits({ overlays: [{ id: 'a', kind: 'text', x: 1, y: 1, size: 20, text: '  ' }] }))).toBe(false);
    expect(hasEdits(edits({ overlays: [{ id: 'a', kind: 'emoji', x: 1, y: 1, size: 20, text: '🔥' }] }))).toBe(true);
  });

  it('escala para mandar: hasta 1600 px estándar y 4096 en HD', () => {
    expect(sendScale({ w: 3200, h: 2400 }, false)).toBeCloseTo(0.5);
    expect(sendScale({ w: 3200, h: 2400 }, true)).toBe(1);
    expect(sendScale({ w: 800, h: 600 }, false)).toBe(1);
  });

  it('nombre y color', () => {
    expect(outputName('IMG_1.HEIC', 'image/jpeg')).toBe('IMG_1.jpg');
    expect(outputName('', 'image/png')).toBe('photo.png');
    expect(isLight('#ffffff')).toBe(true);
    expect(isLight('#111')).toBe(false);
  });
});

describe('wa-image-edit: renderEdits', () => {
  function fakeCtx() {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => calls.push(`${k}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : typeof a)).join(',')})`)),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    return { ctx: ctx as unknown as Ctx2D, calls };
  }

  it('dibuja la foto, los trazos y el texto, con el recorte y la rotación', () => {
    const { ctx, calls } = fakeCtx();
    const e = edits({
      rotate: 90,
      crop: { x: 10, y: 10, w: 100, h: 50 },
      strokes: [{ color: '#f00', width: 5, points: [20, 20, 30, 30] }],
      overlays: [{ id: 't', kind: 'text', x: 40, y: 30, size: 12, text: 'Hola', color: '#fff' }],
    });
    renderEdits(ctx, {}, natural, e, 0.5);
    expect(calls).toContain('scale(0.5,0.5)');
    expect(calls).toContain('translate(50,0)');
    expect(calls).toContain('rect(10,10,100,50)');
    expect(calls).toContain('drawImage(object,0,0,400,300)');
    expect(calls).toContain('lineTo(30,30)');
    expect(calls.some((c) => c.startsWith('fillText(string'))).toBe(true);
  });

  it('salta el texto que se está escribiendo', () => {
    const { ctx, calls } = fakeCtx();
    renderEdits(ctx, {}, natural, edits({ overlays: [{ id: 't', kind: 'text', x: 1, y: 1, size: 12, text: 'x' }] }), 1, { skipOverlay: 't' });
    expect(calls.some((c) => c.startsWith('fillText'))).toBe(false);
  });

  it('desenfoque: la copia desenfocada recortada a círculos a lo largo del trazo, sin pintar con el lápiz', () => {
    const { ctx, calls } = fakeCtx();
    const blurred = { blurred: true };
    const e = edits({ strokes: [{ color: '', width: 20, points: [10, 10, 40, 10], blur: true }, { color: '#f00', width: 5, points: [1, 1, 2, 2] }] });
    renderEdits(ctx, {}, natural, e, 1, { blurred });
    const arcs = calls.filter((c) => c.startsWith('arc('));
    // De 10 a 40 con un paso de un tercio del ancho: los dos puntos y los intermedios.
    expect(arcs.length).toBe(blurDabs(e.strokes[0]).length);
    expect(arcs[0]).toBe('arc(10,10,10,0,6.28)');
    expect(calls.filter((c) => c === 'drawImage(object,0,0,400,300)')).toHaveLength(2);
    // El lápiz no dibuja la pasada de desenfoque: un solo trazo de color.
    expect(calls.filter((c) => c === 'stroke()')).toHaveLength(1);
    // Sin la copia desenfocada (todavía cargando) no se recorta nada.
    const plain = fakeCtx();
    renderEdits(plain.ctx, {}, natural, e, 1);
    expect(plain.calls.some((c) => c.startsWith('arc('))).toBe(false);
  });
});

describe('wa-image-edit: desenfoque y filtros', () => {
  it('cuentan como cambios (la foto se vuelve a dibujar al mandar)', () => {
    expect(hasEdits(edits({ filter: 'bw' }))).toBe(true);
    expect(hasEdits(edits({ filter: 'none' }))).toBe(false);
    expect(hasEdits(edits({ strokes: [{ color: '', width: 9, points: [1, 1], blur: true }] }))).toBe(true);
    expect(hasBlur(edits({ strokes: [{ color: '', width: 9, points: [1, 1, 2, 2], blur: true }] }))).toBe(true);
    expect(hasBlur(edits({ strokes: [{ color: '#fff', width: 9, points: [1, 1, 2, 2] }] }))).toBe(false);
  });

  it('el pincel cubre el trazo sin huecos aunque se mueva rápido', () => {
    const dabs = blurDabs({ color: '', width: 30, points: [0, 0, 100, 0] });
    const xs = dabs.map((d) => d.x);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(100);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(10.0001);
  });

  it('B&N deja gris, Original no cambia nada, la transparencia queda', () => {
    expect(FILTER_MATRIX.none).toBeNull();
    const px = new Uint8ClampedArray([200, 40, 90, 128, 10, 220, 30, 255]);
    applyColorMatrix(px, FILTER_MATRIX.bw!);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[4]).toBe(px[5]);
    expect(px[3]).toBe(128);
    expect(px[7]).toBe(255);
  });

  it('Pop da más color, Frío tira al azul y Película levanta los negros', () => {
    const run = (f: FilterId, rgb: number[]) => {
      const px = new Uint8ClampedArray([...rgb, 255]);
      applyColorMatrix(px, FILTER_MATRIX[f]!);
      return [px[0], px[1], px[2]];
    };
    const [r, g, b] = run('pop', [180, 120, 100]);
    expect(r - b).toBeGreaterThan(80);
    expect(g).toBeLessThan(140);
    const cool = run('cool', [128, 128, 128]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(run('film', [0, 0, 0])[0]).toBeGreaterThan(0);
    expect(FILTERS.every((f) => isFilter(f))).toBe(true);
    expect(isFilter('sepia')).toBe(false);
  });

  it('compose aplica primero la de la derecha', () => {
    const m = compose(contrast(2), saturate(0));
    const px = new Uint8ClampedArray([255, 0, 0, 255]);
    applyColorMatrix(px, m);
    // Gris de un rojo puro (54) y después el contraste alrededor del medio: 2 × 54 − 127,5 ≈ −19 → 0.
    expect(px[0]).toBe(0);
  });
});
