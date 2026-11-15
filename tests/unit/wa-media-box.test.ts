import { describe, expect, it } from 'vitest';
import { MEDIA_W, PLACEHOLDER_BOX, mediaBox, mediaBoxStyle, placeholderBox } from '@/components/groups/wa/media-box';

describe('mediaBox: tamaño de una foto o un video en la burbuja', () => {
  it('sin medidas no hay caja', () => {
    expect(mediaBox()).toBeNull();
    expect(mediaBox(0, 100)).toBeNull();
    expect(mediaBox(100, 0)).toBeNull();
    expect(mediaBox(Number.NaN, 100)).toBeNull();
  });

  it('una foto de teléfono (vertical) ocupa el ancho entero, recortada a 3:4', () => {
    expect(mediaBox(1080, 1920)).toEqual({ width: MEDIA_W, height: 400 });
    expect(mediaBox(3024, 4032)).toEqual({ width: MEDIA_W, height: 400 });
  });

  it('una horizontal ocupa el ancho entero con su proporción', () => {
    expect(mediaBox(1920, 1080)).toEqual({ width: MEDIA_W, height: 169 });
    expect(mediaBox(1600, 1200)).toEqual({ width: MEDIA_W, height: 225 });
  });

  it('una panorámica no queda como una tira: tope 2,4:1', () => {
    expect(mediaBox(4000, 500)).toEqual({ width: MEDIA_W, height: 125 });
  });

  it('una chica queda de su tamaño, nunca menos de 100 de ancho', () => {
    expect(mediaBox(200, 150)).toEqual({ width: 200, height: 150 });
    expect(mediaBox(40, 40)).toEqual({ width: 100, height: 100 });
  });
});

describe('placeholderBox: el lugar de la media que no cargó o no está', () => {
  it('con medidas usa las de la foto', () => {
    expect(placeholderBox(1080, 1920)).toEqual({ width: MEDIA_W, height: 400 });
  });

  it('sin medidas usa el lugar estándar (ancho entero, 4:3), nunca angosto', () => {
    expect(placeholderBox()).toEqual(PLACEHOLDER_BOX);
    expect(placeholderBox(undefined, 300)).toEqual(PLACEHOLDER_BOX);
    expect(placeholderBox().width).toBeGreaterThanOrEqual(280);
  });
});

describe('mediaBoxStyle', () => {
  it('escala con --wa-media-w y fija la proporción', () => {
    expect(mediaBoxStyle({ width: 300, height: 400 })).toEqual({ width: 'calc(var(--wa-media-w, 300px) * 1)', aspectRatio: '300 / 400' });
    expect(mediaBoxStyle({ width: 150, height: 100 })?.width).toBe('calc(var(--wa-media-w, 300px) * 0.5)');
    expect(mediaBoxStyle(null)).toBeUndefined();
  });
});
