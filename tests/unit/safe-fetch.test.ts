import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl } from '@/lib/safe-fetch';
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

  it('acepta IPs públicas', async () => {
    await expect(assertPublicUrl('https://93.184.216.34/hook')).resolves.toBeInstanceOf(URL);
  });

  it('firma estilo Stripe verificable con el secret', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')}`);
  });
});
