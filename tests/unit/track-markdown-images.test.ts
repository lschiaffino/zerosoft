import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOwnUpload, renderTrackMarkdown } from '@/lib/track-markdown';

describe('imágenes propias en Markdown', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('una subida local tiene una sola forma', () => {
    expect(isOwnUpload('/uploads/track/abc-foto.png')).toBe(true);
    for (const bad of [
      '/uploads/../api/analytics/export?project=x',
      '/uploads/track/../../api/keys',
      '/uploads/%2e%2e/api/keys',
      '/uploads/track/a.png?x=1',
      '/uploads/track/a/b.png',
      '/uploads/track/..',
      '/uploads//api/keys',
      '/uploads/track\\..\\x',
      '/api/keys',
    ]) {
      expect(isOwnUpload(bad), bad).toBe(false);
    }
  });

  it('solo nuestro store de Blob, y sin token ninguno', () => {
    expect(isOwnUpload('https://abc123.public.blob.vercel-storage.com/x.png')).toBe(false);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_ABC123_rest');
    expect(isOwnUpload('https://abc123.public.blob.vercel-storage.com/x.png')).toBe(true);
    for (const bad of ['https://attacker.public.blob.vercel-storage.com/x.png', 'http://abc123.public.blob.vercel-storage.com/x.png', 'https://abc123.public.blob.vercel-storage.com.evil.dev/x.png', 'https://user@abc123.public.blob.vercel-storage.com/x.png']) {
      expect(isOwnUpload(bad), bad).toBe(false);
    }
  });

  it('el host que deja la compilación vale en el navegador', () => {
    vi.stubEnv('NEXT_PUBLIC_OWN_BLOB_HOST', 'store9.public.blob.vercel-storage.com');
    expect(isOwnUpload('https://store9.public.blob.vercel-storage.com/x.png')).toBe(true);
    expect(isOwnUpload('https://other.public.blob.vercel-storage.com/x.png')).toBe(false);
  });

  it('lo que no es propio queda como link, nunca como imagen', () => {
    const html = renderTrackMarkdown('![a](/uploads/../api/analytics/export?x=1) ![b](https://attacker.public.blob.vercel-storage.com/x.png)');
    expect(html).not.toContain('<img');
    expect(renderTrackMarkdown('![a](/uploads/track/a.png)')).toContain('<img src="/uploads/track/a.png"');
  });
});
