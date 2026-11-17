import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { micConstraints } from '@/components/rec/recorder-media';

describe('micConstraints', () => {
  it('no toca el volumen del sistema ni pasa el micrófono a modo voz', () => {
    const c = micConstraints('', true);
    expect(c.autoGainControl).toBe(false);
    expect(c.echoCancellation).toBe(false);
    expect(c.noiseSuppression).toBe(true);
    expect(c.deviceId).toBeUndefined();
  });
  it('respeta el micrófono elegido y la supresión de ruido apagada', () => {
    const c = micConstraints('mic-1', false);
    expect(c.deviceId).toEqual({ exact: 'mic-1' });
    expect(c.noiseSuppression).toBe(false);
  });
});

describe('isBlackPixels', () => {
  it('negro puro y casi negro cuentan como negro; un píxel con luz no', async () => {
    const { isBlackPixels } = await import('@/components/rec/recorder-media');
    const black = new Uint8ClampedArray(48 * 27 * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    expect(isBlackPixels(black)).toBe(true);
    const dim = black.slice();
    dim[0] = 6;
    expect(isBlackPixels(dim)).toBe(true);
    const lit = black.slice();
    lit[400] = 200;
    expect(isBlackPixels(lit)).toBe(false);
  });
});

describe('systemAudioSource', () => {
  it('la app de escritorio en Mac captura el audio de la compu nativo', async () => {
    const { systemAudioSource } = await import('@/components/rec/recorder-media');
    expect(systemAudioSource(true, { systemAudio: true, systemAudioStart: () => Promise.resolve('ok') })).toBe('native');
  });
  it('el navegador y Windows (WebView2, sin captura nativa) lo piden a getDisplayMedia', async () => {
    const { systemAudioSource } = await import('@/components/rec/recorder-media');
    expect(systemAudioSource(true, null)).toBe('display');
    expect(systemAudioSource(true, { systemAudio: false })).toBe('display');
    // Una app vieja que dice tener audio pero no trae el comando.
    expect(systemAudioSource(true, { systemAudio: true })).toBe('display');
  });
  it('apagado, no se pide en ningún lado', async () => {
    const { systemAudioSource } = await import('@/components/rec/recorder-media');
    expect(systemAudioSource(false, { systemAudio: true, systemAudioStart: () => Promise.resolve('ok') })).toBe('none');
    expect(systemAudioSource(false, null)).toBe('none');
  });
});

describe('mixAudio: micrófono y audio de la compu en una pista', () => {
  type Node = { connected: unknown[]; connect: (n: unknown) => void };
  const node = (): Node => {
    const n: Node = { connected: [], connect: (to) => n.connected.push(to) };
    return n;
  };
  class FakeCtx {
    static made = 0;
    state = 'suspended';
    closed = false;
    resumed = 0;
    sources: Array<Node & { stream: unknown }> = [];
    dest = { ...node(), stream: { getAudioTracks: () => [{ id: 'mixed' }] } };
    analyser = { ...node(), fftSize: 0 };
    constructor() {
      FakeCtx.made += 1;
    }
    resume() {
      this.resumed += 1;
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
    createMediaStreamDestination() {
      return this.dest;
    }
    createAnalyser() {
      return this.analyser;
    }
    createMediaStreamSource(stream: unknown) {
      const s = { ...node(), stream };
      this.sources.push(s);
      return s;
    }
  }
  const stream = (audio: number) => ({ getAudioTracks: () => Array.from({ length: audio }, (_, i) => ({ id: `a${i}` })) }) as unknown as MediaStream;

  beforeEach(() => {
    FakeCtx.made = 0;
    vi.stubGlobal('window', { AudioContext: FakeCtx });
    vi.stubGlobal(
      'MediaStream',
      class {
        constructor(public tracks: unknown[]) {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('usa el contexto creado en el clic (ya en marcha) y mezcla las dos fuentes', async () => {
    const { audioContextForClick, mixAudio } = await import('@/components/rec/recorder-media');
    const prepared = audioContextForClick() as unknown as FakeCtx;
    expect(prepared.resumed).toBe(1);
    const mixed = mixAudio([stream(1), stream(1)], prepared as unknown as AudioContext);
    expect(FakeCtx.made).toBe(1);
    expect(mixed.ctx).toBe(prepared);
    expect(mixed.track).toEqual({ id: 'mixed' });
    expect(prepared.sources).toHaveLength(2);
    for (const s of prepared.sources) expect(s.connected).toEqual([prepared.dest, prepared.analyser]);
    expect(prepared.closed).toBe(false);
  });

  it('sin contexto del clic crea uno e intenta arrancarlo', async () => {
    const { mixAudio } = await import('@/components/rec/recorder-media');
    const mixed = mixAudio([stream(1), null]);
    expect(FakeCtx.made).toBe(1);
    expect((mixed.ctx as unknown as FakeCtx).resumed).toBe(1);
  });

  it('sin audio no hay pista y el contexto del clic se cierra', async () => {
    const { audioContextForClick, mixAudio } = await import('@/components/rec/recorder-media');
    const prepared = audioContextForClick() as unknown as FakeCtx;
    const mixed = mixAudio([stream(0), null], prepared as unknown as AudioContext);
    expect(mixed).toEqual({ track: null, ctx: null, analyser: null });
    expect(prepared.closed).toBe(true);
  });
});
