import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Blob simulado: registra lo que se pide para ver acceso y rangos.
const calls: Array<{ fn: string; url: string; opts?: { access?: string; headers?: Record<string, string> } }> = [];
vi.mock('@vercel/blob', () => ({
  head: vi.fn(async (url: string) => {
    calls.push({ fn: 'head', url });
    return { size: 10 * 1024 * 1024 };
  }),
  get: vi.fn(async (url: string, opts: { access: string; headers?: Record<string, string> }) => {
    calls.push({ fn: 'get', url, opts });
    return { statusCode: 200, stream: new Blob([new Uint8Array(8)]).stream(), headers: new Headers() };
  }),
  put: vi.fn(async (pathname: string, _body: unknown, opts: { access: string }) => {
    calls.push({ fn: 'put', url: pathname, opts });
    return { url: `https://x.private.blob.vercel-storage.com/${pathname}` };
  }),
  del: vi.fn(),
}));

import { REC_SERVE_CHUNK, recBlobAccess, saveRecAsset, serveRecFile } from '@/lib/rec-upload';

const URL_ = 'https://store.public.blob.vercel-storage.com/rec/ws/vid/abc-video.webm';
const req = (range?: string) => new NextRequest('http://localhost/api/rec/videos/vid/file', { headers: range ? { range } : {} });

afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
});

describe('Rec sirve Blob por la ruta, sin redirigir', () => {
  it('con Range responde 206 de a 4 MB como máximo y no expone la URL', async () => {
    const res = await serveRecFile(req('bytes=0-'), URL_, 'video/webm', { size: 10 * 1024 * 1024 });
    expect(res.status).toBe(206);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-range')).toBe(`bytes 0-${REC_SERVE_CHUNK - 1}/${10 * 1024 * 1024}`);
    expect(calls[0]).toMatchObject({ fn: 'get', opts: { access: 'public', headers: { range: `bytes=0-${REC_SERVE_CHUNK - 1}` } } });
    const mid = await serveRecFile(req('bytes=9000000-9000100'), URL_, 'video/webm', { size: 10 * 1024 * 1024 });
    expect(mid.headers.get('content-range')).toBe('bytes 9000000-9000100/10485760');
  });

  it('archivo chico sin Range: 200 entero; fuera de rango: 416; sin tamaño: lo pide con head', async () => {
    const small = await serveRecFile(req(), URL_, 'image/jpeg', { size: 1000 });
    expect(small.status).toBe(200);
    const bad = await serveRecFile(req('bytes=999999999-'), URL_, 'video/webm', { size: 1000 });
    expect(bad.status).toBe(416);
    calls.length = 0;
    const big = await serveRecFile(req(), URL_, 'video/webm');
    expect(calls[0].fn).toBe('head');
    expect(big.status).toBe(206);
  });

  it('con REC_BLOB_ACCESS=private lee y guarda con acceso privado', async () => {
    vi.stubEnv('REC_BLOB_ACCESS', 'private');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'x');
    expect(recBlobAccess()).toBe('private');
    await serveRecFile(req('bytes=0-10'), URL_, 'video/webm', { size: 100 });
    expect(calls[0].opts?.access).toBe('private');
    const url = await saveRecAsset('ws', 'vid', 'thumb', 'image/jpeg', Buffer.from('x'));
    expect(url).toMatch(/^https:\/\/x\.private\.blob\.vercel-storage\.com\/rec\/ws\/vid\/[\w-]{12}-thumb\.jpg$/);
    expect(calls.find((c) => c.fn === 'put')?.opts?.access).toBe('private');
  });

  it('URLs que no son de nuestro Blob no se sirven', async () => {
    expect((await serveRecFile(req(), 'https://evil.example.com/x.webm', 'video/webm', { size: 10 })).status).toBe(404);
  });
});
