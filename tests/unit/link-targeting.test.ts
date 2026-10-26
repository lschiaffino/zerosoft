import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { createLink, getUserLink, toLinkDto } from '@/lib/links';
import {
  deepLinkHtml,
  deviceClass,
  linkTargetingSchema,
  normalizeTargeting,
  parseTargeting,
  pickWeighted,
  resolveDestination,
  type LinkTargeting,
} from '@/lib/link-targeting';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string }) => u.id,
}));
// after() necesita el contexto de request de Next: en tests corre en el acto.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');
const linkRoute = await import('@/lib/routes/links/[id]/route');
const v1LinkRoute = await import('@/lib/routes/v1/links/[id]/route');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

function visit(s: string, opts: { ua?: string; cookie?: string; qr?: boolean } = {}) {
  const headers: Record<string, string> = { host: 'localhost:3000', 'user-agent': opts.ua ?? DESKTOP };
  if (opts.cookie) headers.cookie = opts.cookie;
  return redirectRoute.GET(new NextRequest(`http://localhost:3000/r/${s}${opts.qr ? '?qr=1' : ''}`, { headers }), {
    params: Promise.resolve({ slug: s }),
  });
}

const T = (t: Partial<LinkTargeting>): LinkTargeting => ({ rules: [], ab: [], ios: null, android: null, ...t });

describe('Link targeting: resolución (pura)', () => {
  const ctx = (os: string, country: string | null = 'AR') => ({ os, country, device: 'desktop' });

  it('sin reglas devuelve la URL del link', () => {
    expect(resolveDestination('https://a.com', null, ctx('Mac OS'), 's')).toEqual({
      kind: 'redirect',
      url: 'https://a.com',
      variant: null,
    });
  });

  it('clasifica dispositivos por sistema operativo', () => {
    expect(deviceClass({ os: 'iOS' })).toBe('ios');
    expect(deviceClass({ os: 'Android' })).toBe('android');
    expect(deviceClass({ os: 'Windows' })).toBe('desktop');
  });

  it('gana la primera regla que coincide (país y dispositivo)', () => {
    const t = T({
      rules: [
        { countries: ['AR'], devices: ['ios'], url: 'https://ar-ios.com' },
        { countries: ['AR'], devices: [], url: 'https://ar.com' },
        { countries: [], devices: ['android'], url: 'https://android.com' },
      ],
    });
    expect(resolveDestination('https://d.com', t, ctx('iOS'), 's')).toMatchObject({ url: 'https://ar-ios.com', variant: 'rule:1' });
    expect(resolveDestination('https://d.com', t, ctx('Windows'), 's')).toMatchObject({ url: 'https://ar.com', variant: 'rule:2' });
    expect(resolveDestination('https://d.com', t, ctx('Android', 'BR'), 's')).toMatchObject({ url: 'https://android.com' });
    expect(resolveDestination('https://d.com', t, ctx('Windows', null), 's')).toMatchObject({ url: 'https://d.com', variant: null });
  });

  it('A/B es determinístico por seed y respeta los pesos', () => {
    expect(pickWeighted([50, 50], 'v1:l')).toBe(pickWeighted([50, 50], 'v1:l'));
    expect(pickWeighted([0, 100], 'cualquiera')).toBe(1);
    expect(pickWeighted([100, 0], 'cualquiera')).toBe(0);
    const counts = [0, 0];
    for (let i = 0; i < 4000; i++) counts[pickWeighted([25, 75], `visitor-${i}:link`)]++;
    expect(counts[1] / 4000).toBeGreaterThan(0.7);
    expect(counts[1] / 4000).toBeLessThan(0.8);
    const t = T({ ab: [{ url: 'https://a.com', weight: 1 }, { url: 'https://b.com', weight: 1 }] });
    const first = resolveDestination('https://d.com', t, ctx('Windows'), 'vid:link');
    for (let i = 0; i < 5; i++) expect(resolveDestination('https://d.com', t, ctx('Windows'), 'vid:link')).toEqual(first);
  });

  it('deep link: esquema propio → página con fallback; https → redirect directo', () => {
    const t = T({
      ios: { app: 'myapp://item/1', fallback: 'https://apps.apple.com/app/id1' },
      android: { app: 'https://app.example.com/item/1', fallback: null },
      rules: [{ countries: [], devices: ['ios'], url: 'https://web-ios.com' }],
    });
    expect(resolveDestination('https://d.com', t, ctx('iOS'), 's')).toEqual({
      kind: 'deeplink',
      appUrl: 'myapp://item/1',
      fallbackUrl: 'https://apps.apple.com/app/id1',
      variant: 'app:ios',
    });
    expect(resolveDestination('https://d.com', t, ctx('Android'), 's')).toMatchObject({
      kind: 'redirect',
      url: 'https://app.example.com/item/1',
    });
    // Sin fallback propio, cae en el destino web que corresponda (reglas/AB).
    const noFb = T({ ios: { app: 'myapp://x', fallback: null }, rules: t.rules });
    expect(resolveDestination('https://d.com', noFb, ctx('iOS'), 's')).toMatchObject({ fallbackUrl: 'https://web-ios.com' });
    const html = deepLinkHtml('myapp://x"<', 'https://f.com/?a=<b>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('\\u003c');
  });

  it('valida: URLs http(s), reglas no vacías, A/B con 2+ variantes, esquemas peligrosos', () => {
    const n = (v: unknown) => {
      const p = linkTargetingSchema.safeParse(v);
      return p.success ? normalizeTargeting(p.data) : { ok: false as const, error: 'schema' };
    };
    expect(n({ rules: [{ countries: ['ar'], url: 'example.com/ar' }] })).toEqual({
      ok: true,
      value: { rules: [{ countries: ['AR'], devices: [], url: 'https://example.com/ar' }], ab: [], ios: null, android: null },
    });
    expect(n({ rules: [{ url: 'https://x.com' }] })).toEqual({ ok: false, error: 'empty_rule' });
    expect(n({ rules: [{ countries: ['AR'], url: 'javascript:alert(1)' }] })).toMatchObject({ ok: false });
    expect(n({ ab: [{ url: 'https://a.com', weight: 50 }] })).toEqual({ ok: false, error: 'ab_needs_two' });
    expect(n({ ab: [{ url: 'https://a.com', weight: 0 }, { url: 'https://b.com', weight: 0 }] })).toEqual({ ok: false, error: 'ab_zero_weight' });
    expect(n({ ios: { app: 'javascript:alert(1)' } })).toEqual({ ok: false, error: 'schema' });
    expect(n({ rules: [], ab: [] })).toEqual({ ok: true, value: null });
    expect(parseTargeting('{roto')).toBeNull();
  });
});

describe('Link targeting: redirect y API', () => {
  it('sin reglas: redirect directo, sin cookie de visitante, cuenta el clic', async () => {
    const u = await makeUser('tg');
    const r = await createLink(u.id, { url: 'https://plain.example.com', slug: slug('pl') });
    if (!r.ok) throw new Error(r.code);
    const res = await visit(r.link.slug);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://plain.example.com/');
    expect(res.headers.get('set-cookie')).toBeNull();
    const row = (await getDb().prepare('SELECT source, variant FROM clicks WHERE link_id = ?').get(r.link.id)) as {
      source: string;
      variant: string | null;
    };
    expect(row).toEqual({ source: 'link', variant: null });
  });

  it('aplica reglas por dispositivo, deep link y A/B pegajoso por cookie', async () => {
    const u = await makeUser('tg');
    session.user = u as unknown as Record<string, unknown>;
    const r = await createLink(u.id, { url: 'https://main.example.com', slug: slug('tg') });
    if (!r.ok) throw new Error(r.code);
    const patch = await linkRoute.PATCH(
      new NextRequest(`http://x/api/links/${r.link.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targeting: {
            rules: [{ countries: [], devices: ['android'], url: 'https://android.example.com' }],
            ab: [
              { url: 'https://a.example.com', weight: 50 },
              { url: 'https://b.example.com', weight: 50 },
            ],
            ios: { app: 'myapp://open', fallback: 'https://apps.apple.com/app/id9' },
          },
        }),
      }),
      { params: Promise.resolve({ id: r.link.id }) },
    );
    expect(patch.status).toBe(200);
    const dto = (await patch.json()) as { targeting: LinkTargeting };
    expect(dto.targeting.ab).toHaveLength(2);

    const android = await visit(r.link.slug, { ua: ANDROID });
    expect(android.headers.get('location')).toBe('https://android.example.com/');

    const ios = await visit(r.link.slug, { ua: IPHONE });
    expect(ios.status).toBe(200);
    expect(await ios.text()).toContain('myapp://open');

    const first = await visit(r.link.slug);
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/zs_vid=[a-f0-9]+/);
    const vid = /zs_vid=([a-f0-9]+)/.exec(cookie)![1];
    const dest = first.headers.get('location');
    expect(['https://a.example.com/', 'https://b.example.com/']).toContain(dest);
    for (let i = 0; i < 4; i++) {
      const again = await visit(r.link.slug, { cookie: `zs_vid=${vid}` });
      expect(again.headers.get('location')).toBe(dest);
      expect(again.headers.get('set-cookie')).toBeNull();
    }
    const variants = (await getDb()
      .prepare('SELECT variant FROM clicks WHERE link_id = ? ORDER BY id')
      .all(r.link.id)) as Array<{ variant: string }>;
    expect(variants.map((v) => v.variant).slice(0, 2)).toEqual(['rule:1', 'app:ios']);
    expect(variants[2].variant).toMatch(/^ab:[AB]$/);
  });

  it('PATCH targeting: inválido da 400 y un link ajeno da 404 (app y v1)', async () => {
    const owner = await makeUser('tgo');
    const other = await makeUser('tgx');
    const r = await createLink(owner.id, { url: 'https://o.example.com', slug: slug('to') });
    if (!r.ok) throw new Error(r.code);
    const body = (targeting: unknown) =>
      new NextRequest(`http://x/api/links/${r.link.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targeting }),
      });
    const params = { params: Promise.resolve({ id: r.link.id }) };

    session.user = other as unknown as Record<string, unknown>;
    expect((await linkRoute.PATCH(body({ rules: [] }), params)).status).toBe(404);

    session.user = owner as unknown as Record<string, unknown>;
    const bad = await linkRoute.PATCH(body({ ab: [{ url: 'https://a.com', weight: 10 }] }), params);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'ab_needs_two' });

    const foreignKey = await createApiKey(other.id, 'k');
    const v1 = (key: string, targeting: unknown) =>
      v1LinkRoute.PATCH(
        new NextRequest(`http://x/api/v1/links/${r.link.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ targeting }),
        }),
        params,
      );
    expect((await v1(foreignKey.key, null)).status).toBe(404);
    const key = await createApiKey(owner.id, 'k');
    const ok = await v1(key.key, { rules: [{ countries: ['UY'], url: 'https://uy.example.com' }] });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { targeting: LinkTargeting }).targeting.rules[0].countries).toEqual(['UY']);
    // null limpia la segmentación (vuelve al camino rápido).
    expect((await v1(key.key, null)).status).toBe(200);
    expect(toLinkDto((await getUserLink(owner.id, r.link.id))!).targeting).toBeNull();
  });

  it('?qr=1 cuenta como escaneo QR aparte de los clics', async () => {
    const u = await makeUser('qr');
    const r = await createLink(u.id, { url: 'https://qr.example.com', slug: slug('qr') });
    if (!r.ok) throw new Error(r.code);
    await visit(r.link.slug, { qr: true });
    await visit(r.link.slug, { qr: true });
    await visit(r.link.slug);
    const link = (await getUserLink(u.id, r.link.id))!;
    expect(link.clicks).toBe(3);
    expect(link.qr_scans).toBe(2);
    const rows = (await getDb()
      .prepare('SELECT source, COUNT(*) AS n FROM clicks WHERE link_id = ? GROUP BY source ORDER BY source')
      .all(r.link.id)) as Array<{ source: string; n: number }>;
    expect(rows).toEqual([
      { source: 'link', n: 1 },
      { source: 'qr', n: 2 },
    ]);
  });
});
