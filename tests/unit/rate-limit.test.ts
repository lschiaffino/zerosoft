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

  it('toma la primera IP de x-forwarded-for solo detrás de un proxy de confianza', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('TRUST_PROXY', '');
    expect(clientIp(req)).toBe('untrusted');
    vi.stubEnv('TRUST_PROXY', '1');
    expect(clientIp(req)).toBe('1.2.3.4');
    vi.stubEnv('TRUST_PROXY', '');
    vi.stubEnv('VERCEL', '1');
    expect(clientIp(req)).toBe('1.2.3.4');
    vi.unstubAllEnvs();
  });
});
