import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { clientIp, limitByIp, rateLimit } from '@/lib/rate-limit';

describe('rate limit compartido (DB)', () => {
  it('permite hasta el límite y después bloquea', async () => {
    const key = `t:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit(key, 3, 60)).ok);
    expect(results).toEqual([true, true, true, false]);
  });

  it('las claves son independientes', async () => {
    const a = `t:${crypto.randomUUID()}`;
    const b = `t:${crypto.randomUUID()}`;
    await rateLimit(a, 1, 60);
    expect((await rateLimit(a, 1, 60)).ok).toBe(false);
    expect((await rateLimit(b, 1, 60)).ok).toBe(true);
  });

  it('limitByIp devuelve 429 con retry-after', async () => {
    const req = new Request('http://x/api', { headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}, 1.1.1.1` } });
    const bucket = `b-${crypto.randomUUID()}`;
    expect(await limitByIp(req, bucket, 1, 60)).toBeNull();
    const res = await limitByIp(req, bucket, 1, 60);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('IP del cliente según dónde corre y cuántos proxies hay', () => {
    const req = (headers: Record<string, string>) => new Request('http://x', { headers });
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('TRUST_PROXY', '');
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    // Self-host detrás de un proxy: la entrada que agregó el proxy inmediato (la de la derecha).
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }))).toBe('1.2.3.4');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
    vi.stubEnv('TRUST_PROXY_HOPS', '2');
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(clientIp(req({}))).toBe('unknown');
    vi.stubEnv('TRUST_PROXY', '0');
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
    vi.stubEnv('TRUST_PROXY', '');
    // Vercel: el header del edge, primera entrada.
    vi.stubEnv('VERCEL', '1');
    expect(clientIp(req({ 'x-vercel-forwarded-for': '5.5.5.5', 'x-forwarded-for': '6.6.6.6, 5.5.5.5' }))).toBe('5.5.5.5');
    vi.unstubAllEnvs();
  });
});
