import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, isPrivateIp } from '@/lib/safe-fetch';

const gradeRoute = await import('@/app/api/tools/grade/route');

let ipSeq = 0;
function req(url: unknown, ip = `203.0.113.${(ipSeq++ % 250) + 1}`) {
  return new Request('http://x/api/tools/grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ url }),
  });
}

describe('safeFetch: IPv6 con IPv4 embebida (SSRF)', () => {
  it.each([
    '::ffff:7f00:1', // 127.0.0.1 como lo normaliza new URL()
    '::ffff:a00:1', // 10.0.0.1
    '::ffff:a9fe:a9fe', // 169.254.169.254 (metadata)
    '::ffff:c0a8:101', // 192.168.1.1
    '64:ff9b::7f00:1', // NAT64 → 127.0.0.1
    '::ffff:127.0.0.1',
    'fe80::1',
  ])('%s es privada', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it('IPs públicas siguen pasando', () => {
    expect(isPrivateIp('::ffff:5db8:d822')).toBe(false); // 93.184.216.34
    expect(isPrivateIp('2606:4700::1111')).toBe(false);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
  });

  it.each(['http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/latest/meta-data', 'http://[64:ff9b::a00:1]/'])(
    'assertPublicUrl rechaza %s',
    async (url) => {
      await expect(assertPublicUrl(url)).rejects.toThrow('private_host');
    },
  );
});

describe('API /api/tools/grade', () => {
  const saved = process.env.RATE_LIMIT_DISABLED;
  beforeEach(() => {
    delete process.env.RATE_LIMIT_DISABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RATE_LIMIT_DISABLED;
    else process.env.RATE_LIMIT_DISABLED = saved;
    vi.unstubAllEnvs();
  });

  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/',
    'http://10.0.0.8:8080/admin',
    'http://foo.localhost/',
  ])('bloquea hosts internos: %s → 400 private_host', async (url) => {
    const res = await gradeRoute.POST(req(url));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'private_host' });
  });

  it.each(['http://localhost:3000/', 'http://[::ffff:7f00:1]/', 'http://[::1]/'])(
    'hosts sin dominio (%s) se rechazan antes de cualquier fetch',
    async (url) => {
      const res = await gradeRoute.POST(req(url));
      expect(res.status).toBe(400);
      expect(['invalid_url', 'private_host']).toContain(((await res.json()) as { error: string }).error);
    },
  );

  it('valida el body (URL vacía o enorme)', async () => {
    expect((await gradeRoute.POST(req(''))).status).toBe(400);
    expect((await gradeRoute.POST(req(42))).status).toBe(400);
    expect((await gradeRoute.POST(req(`https://a.test/${'x'.repeat(3000)}`))).status).toBe(400);
  });

  it('rate limit por IP: 20 por hora, la 21ª es 429 con retry-after', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < 20; i++) {
      const res = await gradeRoute.POST(req('not a url', ip));
      expect(res.status).toBe(400);
    }
    const limited = await gradeRoute.POST(req('not a url', ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Otra IP no está afectada.
    expect((await gradeRoute.POST(req('not a url'))).status).toBe(400);
  });

  it('rate limit por sitio destino (todas las IPs)', async () => {
    const host = `target-${crypto.randomUUID().slice(0, 8)}.localhost`;
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await gradeRoute.POST(req(`http://${host}/`))).status;
    expect(last).toBe(429);
  });
});
