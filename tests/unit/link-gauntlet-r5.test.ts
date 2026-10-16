import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { applyLinkPatch, createLink, getUserLink, linkPatchSchema } from '@/lib/links';
import { parseTargeting } from '@/lib/link-targeting';
import { addDomain, MAX_PENDING_DOMAINS } from '@/lib/link-domains';
import { requestLocale } from '@/lib/request-locale';
import { chartDateLabel, spansYears } from '@/lib/chart-dates';
import { makeUser } from './helpers';

// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const host = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}.example.com`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Link r5: el A/B sigue al destino del link', () => {
  it('al cambiar la URL, la variante que apuntaba al destino viejo se mueve con él', async () => {
    const u = await makeUser('abfollow');
    const r = await createLink(u.id, { url: 'https://shop.com/promo-v1', slug: slug('ab') });
    if (!r.ok) throw new Error('setup');
    let link = (await getUserLink(u.id, r.link.id))!;
    expect(
      await applyLinkPatch(
        link,
        linkPatchSchema.parse({
          targeting: { ab: [{ url: link.url, weight: 50 }, { url: 'https://shop.com/promo-b', weight: 50 }] },
        }),
      ),
    ).toBeNull();

    link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ url: 'https://shop.com/promo-v2' }))).toBeNull();
    const after = (await getUserLink(u.id, r.link.id))!;
    expect(after.url).toBe('https://shop.com/promo-v2');
    expect(parseTargeting(after.targeting)?.ab).toEqual([
      { url: 'https://shop.com/promo-v2', weight: 50 },
      { url: 'https://shop.com/promo-b', weight: 50 },
    ]);
  });

  it('si el mismo PATCH trae targeting, manda el targeting que vino', async () => {
    const u = await makeUser('abexplicit');
    const r = await createLink(u.id, { url: 'https://shop.com/a', slug: slug('ab') });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    const ab = [
      { url: 'https://shop.com/a', weight: 50 },
      { url: 'https://shop.com/b', weight: 50 },
    ];
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ url: 'https://shop.com/c', targeting: { ab } }))).toBeNull();
    expect(parseTargeting((await getUserLink(u.id, r.link.id))!.targeting)?.ab).toEqual(ab);
  });
});

describe('Link r5: alta de dominios acotada', () => {
  it('tope de dominios pendientes por usuario', async () => {
    const u = await makeUser('dompend');
    for (let i = 0; i < MAX_PENDING_DOMAINS; i++) expect((await addDomain(u.id, host('p'))).ok).toBe(true);
    expect(await addDomain(u.id, host('p'))).toEqual({ ok: false, code: 'too_many_pending' });
  });

  it('dos altas simultáneas del mismo hostname: una gana y la otra es domain_taken (no un 500)', async () => {
    const [a, b] = [await makeUser('race1'), await makeUser('race2')];
    const h = host('race');
    const results = await Promise.all([addDomain(a.id, h), addDomain(b.id, h)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toEqual({ ok: false, code: 'domain_taken' });
  });

  it('un pendiente vencido también se saca del proyecto de Vercel', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    vi.stubEnv('VERCEL_PROJECT_ID', 'prj');
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET' });
      return new Response('{}', { status: 200 });
    });
    const owner = await makeUser('stale');
    const h = host('stale');
    await getDb()
      .prepare(
        "INSERT INTO link_domains (id, user_id, hostname, verified, created_at) VALUES (?, ?, ?, 0, datetime('now', '-30 days'))",
      )
      .run(crypto.randomUUID(), owner.id, h);

    const other = await makeUser('claim');
    expect((await addDomain(other.id, h)).ok).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes(`/domains/${h}`))).toBe(true);
  });
});

describe('Link r5: locale de /r y /s sin cookie', () => {
  it('negocia Accept-Language contra los locales soportados', () => {
    expect(requestLocale(undefined, 'es-AR,es;q=0.9,en;q=0.8')).toBe('es');
    expect(requestLocale(undefined, 'fr-FR,pt-BR;q=0.7,en;q=0.5')).toBe('pt');
    expect(requestLocale(undefined, 'en;q=0.3,es;q=0.9')).toBe('es');
    expect(requestLocale(undefined, 'de, fr')).toBe('en');
    expect(requestLocale(undefined, null)).toBe('en');
    // La cookie elegida por el usuario manda.
    expect(requestLocale('pt', 'es-AR')).toBe('pt');
    expect(requestLocale('xx', 'es-AR')).toBe('es');
  });

  it('un visitante es-AR que llega a un link inexistente ve /es/gone', async () => {
    const res = await redirectRoute.GET(
      new NextRequest('http://localhost:3000/r/nadaaqui', { headers: { 'accept-language': 'es-AR,es;q=0.9' } }),
      { params: Promise.resolve({ slug: 'nadaaqui' }) },
    );
    expect(res.headers.get('location')).toContain('/es/gone?reason=notfound');
  });
});

describe('Link r5: fechas del gráfico', () => {
  it('formato del locale, con año cuando el rango cruza años', () => {
    expect(chartDateLabel('2026-10-03', 'es', false)).toMatch(/^3 oct/);
    expect(chartDateLabel('2026-10-03', 'en', false)).toBe('Oct 3');
    expect(chartDateLabel('2025-10-03', 'en', true)).toBe('Oct 3, 2025');
    expect(spansYears(['2025-12-30', '2026-01-02'])).toBe(true);
    expect(spansYears(['2026-01-01', '2026-03-02'])).toBe(false);
  });
});
