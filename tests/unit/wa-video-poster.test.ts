import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_BOX } from '@/components/groups/wa/media-box';
import { posterState, videoBox } from '@/components/groups/wa/video-poster';
import { posterFrame } from '@/components/groups/wa/format';

describe('videoBox: la caja del video tiene su proporción real', () => {
  it('con las medidas del mensaje: ancho entero y alto según la proporción', () => {
    expect(videoBox(1280, 720)).toEqual({ width: 300, height: 169 });
    expect(videoBox(360, 480)).toEqual({ width: 300, height: 400 });
  });

  it('uno de teléfono muy alto se recorta como las fotos (3:4), sin bandas', () => {
    expect(videoBox(720, 1280)).toEqual({ width: 300, height: 400 });
  });

  it('sin medidas en el mensaje usa las que leyó el navegador del archivo', () => {
    expect(videoBox(undefined, undefined, { w: 640, h: 480 })).toEqual({ width: 300, height: 225 });
    expect(videoBox(0, 0, { w: 480, h: 640 })).toEqual({ width: 300, height: 400 });
  });

  it('las medidas del mensaje mandan sobre las leídas', () => {
    expect(videoBox(1280, 720, { w: 480, h: 640 })).toEqual({ width: 300, height: 169 });
  });

  it('sin ninguna medida: el lugar estándar', () => {
    expect(videoBox()).toEqual({ ...PLACEHOLDER_BOX });
    expect(videoBox(undefined, undefined, null)).toEqual({ ...PLACEHOLDER_BOX });
  });
});

describe('posterState: qué portada se ve', () => {
  it('el cuadro cuando el navegador ya lo dibujó', () => {
    expect(posterState(true, 'data:image/jpeg;base64,AA')).toBe('frame');
    expect(posterState(true)).toBe('frame');
  });

  it('mientras tanto, la miniatura de WhatsApp; sin miniatura, nada', () => {
    expect(posterState(false, 'data:image/jpeg;base64,AA')).toBe('thumb');
    expect(posterState(false)).toBe('none');
    expect(posterState(false, '')).toBe('none');
  });

  it('el video se pide desde el primer cuadro (#t=0.1), por la misma ruta con sesión', () => {
    expect(posterFrame('/api/inbox/media/m1')).toBe('/api/inbox/media/m1#t=0.1');
  });
});
