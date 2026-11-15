import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ tokens: [] as Array<Record<string, unknown>>, gets: [] as Array<{ url: string; opts: Record<string, unknown> }> }));
vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: async (o: Record<string, unknown>) => {
    calls.tokens.push(o);
    return 'client-token';
  },
}));
vi.mock('@vercel/blob', () => ({
  get: async (url: string, opts: Record<string, unknown>) => {
    calls.gets.push({ url, opts });
    return { statusCode: 200, stream: new Response('x').body };
  },
}));

const rec = await import('@/lib/rec-upload');

describe('Rec con el store privado de archivos', () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
    calls.tokens.length = 0;
    calls.gets.length = 0;
  });

  it('sin store privado, como antes', async () => {
    delete process.env.FILES_BLOB_READ_WRITE_TOKEN;
    delete process.env.REC_BLOB_ACCESS;
    expect(rec.recBlobAccess()).toBe('public');
    const out = await rec.issueBlobToken('ws1', '0b7f0a8e-1111-4222-8333-444455556666', 'video', 'video/webm');
    expect(out.access).toBe('public');
    expect(calls.tokens[0].token).toBeUndefined();
  });

  it('con FILES_BLOB_READ_WRITE_TOKEN: lo nuevo va privado y se lee con su token', async () => {
    process.env.FILES_BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_priv_x';
    expect(rec.recBlobAccess()).toBe('private');
    expect(rec.blobUploadEnabled()).toBe(true);
    const out = await rec.issueBlobToken('ws1', '0b7f0a8e-1111-4222-8333-444455556666', 'video', 'video/webm');
    expect(out.access).toBe('private');
    expect(calls.tokens[0].token).toBe('vercel_blob_rw_priv_x');
    expect(rec.recBlobOpts('https://abc.private.blob.vercel-storage.com/rec/ws1/v/a-video.webm')).toEqual({ access: 'private', token: 'vercel_blob_rw_priv_x' });
    // Lo de antes (store público) se sigue leyendo como antes.
    expect(rec.recBlobOpts('https://abc.public.blob.vercel-storage.com/rec/ws1/v/a-video.webm')).toEqual({ access: 'public' });
    await rec.readRecBlob('https://abc.private.blob.vercel-storage.com/rec/ws1/v/a-audio.weba');
    expect(calls.gets[0].opts).toMatchObject({ access: 'private', token: 'vercel_blob_rw_priv_x' });
  });
});
