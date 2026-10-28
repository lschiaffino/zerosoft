import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, safeFetch } from '@/lib/safe-fetch';
import { signPayload } from '@/lib/webhooks';
import { createHmac } from 'crypto';

describe('salidas HTTP seguras (SSRF)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://127.0.0.1:8080/',
    'http://localhost/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://metadata.google.internal/',
    'ftp://example.com/',
  ])('rechaza %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  it('en producción exige https', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(assertPublicUrl('http://93.184.216.34/')).rejects.toThrow('https_required');
  });

  it('al redirigir a otro origen no reenvía headers con secretos propios (X-Api-Key)', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const seen: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers) });
        return String(url).startsWith('http://api.test')
          ? new Response(null, { status: 302, headers: { location: 'http://other.test/next' } })
          : new Response('ok');
      }),
    );
    await safeFetch('http://api.test/a', { headers: { 'x-api-key': 's3cret', authorization: 'Bearer t', 'content-type': 'application/json' } }, 5000, {
      maxRedirects: 2,
    });
    expect(seen[0].headers.get('x-api-key')).toBe('s3cret');
    expect(seen[1].url).toBe('http://other.test/next');
    expect(seen[1].headers.get('x-api-key')).toBeNull();
    expect(seen[1].headers.get('authorization')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('acepta IPs públicas', async () => {
    await expect(assertPublicUrl('https://93.184.216.34/hook')).resolves.toBeInstanceOf(URL);
  });

  it('firma estilo Stripe verificable con el secret', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')}`);
  });
});
