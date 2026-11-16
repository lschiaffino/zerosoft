import { describe, expect, it } from 'vitest';
import { fromView, hasEdits, isLight, needsRender, NO_EDITS, outputName, rectFromView, renderEdits, rotateLeft, sendScale, toView, viewSize, type Ctx2D, type Edits, type Rotation } from '@/lib/wa-image-edit';

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
});
