import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { applyLinkPatch, createLink, gateCookieName, gateToken, getUserLink, linkPatchSchema, toLinkDto } from '@/lib/links';
import { forwardQueryParams, gateQueryString, readUtm, syncUtm } from '@/lib/link-url';
import { makeUser } from './helpers';

// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const session = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const redirectRoute = await import('@/app/r/[slug]/route');
const domainRoute = await import('@/lib/routes/links/domains/[id]/route');

const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

function visit(s: string, opts: { search?: string; host?: string; ua?: string } = {}) {
  const host = opts.host ?? 'localhost:3000';
  return redirectRoute.GET(
    new NextRequest(`http://${host}/r/${s}${opts.search ?? ''}`, {
      headers: { host, 'user-agent': opts.ua ?? DESKTOP },
    }),
    { params: Promise.resolve({ slug: s }) },
  );
}

async function verifiedDomain(userId: string, extra: { not_found_url?: string; expired_url?: string } = {}) {
  const id = crypto.randomUUID();
  const hostname = `go-${id.slice(0, 8)}.example.com`;
  await getDb()
    .prepare('INSERT INTO link_domains (id, user_id, hostname, verified, not_found_url, expired_url) VALUES (?, ?, ?, 1, ?, ?)')
    .run(id, userId, hostname, extra.not_found_url ?? null, extra.expired_url ?? null);
  return { id, hostname };
}

describe('forwardQueryParams', () => {
  it('suma los params del link corto y gana en conflicto', () => {
    const out = forwardQueryParams(
      'https://shop.example.com/p?utm_source=site&ref=1#top',
      new URLSearchParams('utm_source=newsletter&utm_medium=email'),
    );
    const u = new URL(out);
    expect(u.searchParams.get('utm_source')).toBe('newsletter');
    expect(u.searchParams.get('utm_medium')).toBe('email');
    expect(u.searchParams.get('ref')).toBe('1');
    expect(u.hash).toBe('#top');
  });

  it('descarta los reservados (qr) y no toca el destino si no queda nada', () => {
    const dest = 'https://example.com/a?x=1';
    expect(forwardQueryParams(dest, new URLSearchParams('qr=1'))).toBe(dest);
    expect(forwardQueryParams(dest, new URLSearchParams(''))).toBe(dest);
    expect(new URL(forwardQueryParams(dest, new URLSearchParams('qr=1&c=2'))).searchParams.has('qr')).toBe(false);
  });

  it('respeta valores repetidos y devuelve tal cual un destino que no parsea', () => {
    const out = forwardQueryParams('https://example.com/?tag=a', new URLSearchParams('tag=b&tag=c'));
    expect(new URL(out).searchParams.getAll('tag')).toEqual(['b', 'c']);
    expect(forwardQueryParams('not a url', new URLSearchParams('a=1'))).toBe('not a url');
  });
});

describe('Link: parámetros del link corto en /r', () => {
  it('pasan al destino por defecto, sin el ?qr', async () => {
    const u = await makeUser('fwd');
    const r = await createLink(u.id, { url: 'https://example.com/landing?utm_source=site', slug: slug('fw') });
    if (!r.ok) throw new Error('setup');
    expect(toLinkDto(r.link).forward_params).toBe(true);
    const res = await visit(r.link.slug, { search: '?utm_source=newsletter&qr=1&promo=10' });
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('utm_source')).toBe('newsletter');
    expect(loc.searchParams.get('promo')).toBe('10');
    expect(loc.searchParams.has('qr')).toBe(false);
  });

  it('se apagan por link', async () => {
    const u = await makeUser('fwd2');
    const r = await createLink(u.id, { url: 'https://example.com/landing', slug: slug('fo'), forwardParams: false });
    if (!r.ok) throw new Error('setup');
    expect(toLinkDto(r.link).forward_params).toBe(false);
    const res = await visit(r.link.slug, { search: '?utm_source=newsletter' });
    expect(res.headers.get('location')).toBe('https://example.com/landing');

    const link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ forwardParams: true }))).toBeNull();
    const on = await visit(r.link.slug, { search: '?utm_source=newsletter' });
    expect(new URL(on.headers.get('location')!).searchParams.get('utm_source')).toBe('newsletter');
  });

  it('también llegan al fallback web de un deep link', async () => {
    const u = await makeUser('fwd3');
    const r = await createLink(u.id, { url: 'https://example.com/app', slug: slug('fd') });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    const patch = linkPatchSchema.parse({ targeting: { ios: { app: 'myapp://open', fallback: 'https://example.com/ios' } } });
    expect(await applyLinkPatch(link, patch)).toBeNull();
    const res = await visit(r.link.slug, { search: '?utm_source=ig', ua: IPHONE });
    const html = await res.text();
    expect(html).toContain('https://example.com/ios?utm_source=ig');
  });
});

describe('Link: parámetros a través de la puerta de contraseña', () => {
  it('gateQueryString arma el query de URLSearchParams o de searchParams de Next', () => {
    expect(gateQueryString(new URLSearchParams('utm_source=mail&qr=1'))).toBe('?utm_source=mail&qr=1');
    expect(gateQueryString({ utm_source: 'mail', tag: ['a', 'b'], skip: undefined })).toBe('?utm_source=mail&tag=a&tag=b');
    expect(gateQueryString({})).toBe('');
    expect(gateQueryString(undefined)).toBe('');
    // Lo raro se codifica: no puede salirse del query.
    expect(gateQueryString({ 'a#b': 'x/../y?z' })).toBe('?a%23b=x%2F..%2Fy%3Fz');
  });

  it('la puerta recibe los params y, desbloqueado, el destino también', async () => {
    const u = await makeUser('fwdgate');
    const r = await createLink(u.id, { url: 'https://example.com/landing', slug: slug('fg'), password: 'secreto' });
    if (!r.ok) throw new Error('setup');
    const s = r.link.slug;
    const toGate = await visit(s, { search: '?utm_source=newsletter&qr=1' });
    const gateUrl = new URL(toGate.headers.get('location')!);
    expect(gateUrl.pathname).toMatch(new RegExp(`/gate/${s}$`));
    expect(gateUrl.searchParams.get('utm_source')).toBe('newsletter');
    expect(gateUrl.searchParams.get('qr')).toBe('1');

    // La página de la puerta reenvía el mismo query a /<slug> al desbloquear.
    const back = gateQueryString(Object.fromEntries(gateUrl.searchParams));
    const link = (await getUserLink(u.id, r.link.id))!;
    const res = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${s}${back}`, {
        headers: {
          host: 'localhost:3000',
          'user-agent': DESKTOP,
          cookie: `${gateCookieName(s)}=${gateToken(s, link.password_hash!)}`,
        },
      }),
      { params: Promise.resolve({ slug: s }) },
    );
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://example.com/landing');
    expect(loc.searchParams.get('utm_source')).toBe('newsletter');
    expect(loc.searchParams.has('qr')).toBe(false);
    const click = (await getDb().prepare('SELECT source FROM clicks WHERE link_id = ?').get(r.link.id)) as
      | { source: string }
      | undefined;
    expect(click?.source).toBe('qr');
  });

  it('un link con contraseña vencido sigue yendo a su fallback, no a la puerta', async () => {
    const u = await makeUser('fwdgexp');
    const r = await createLink(u.id, {
      url: 'https://example.com/landing',
      slug: slug('fe'),
      password: 'secreto',
      expiredUrl: 'https://example.com/ended',
    });
    if (!r.ok) throw new Error('setup');
    await getDb().prepare("UPDATE links SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(r.link.id);
    const res = await visit(r.link.slug, { search: '?utm_source=newsletter' });
    expect(res.headers.get('location')).toBe('https://example.com/ended');
  });
});

describe('Link: UTM editables y en sync con el destino', () => {
  it('syncUtm pone, cambia y saca params sin tocar lo demás', () => {
    const base = 'https://example.com/p?utm_source=a&utm_medium=b&x=1';
    const out = syncUtm(base, { source: 'news', medium: '', campaign: 'q4' });
    const u = new URL(out.url);
    expect(u.searchParams.get('utm_source')).toBe('news');
    expect(u.searchParams.has('utm_medium')).toBe(false);
    expect(u.searchParams.get('utm_campaign')).toBe('q4');
    expect(u.searchParams.get('x')).toBe('1');
    expect(out.utm).toEqual({ source: 'news', medium: null, campaign: 'q4', term: null, content: null });
    // Sin cambios la URL vuelve idéntica.
    expect(syncUtm('https://example.com?utm_source=a').url).toBe('https://example.com?utm_source=a');
    expect(readUtm('example.com/?utm_medium=email').medium).toBe('email');
  });

  it('el PATCH de UTM reescribe la URL y las columnas', async () => {
    const u = await makeUser('utm');
    const r = await createLink(u.id, { url: 'https://example.com/p', slug: slug('ut'), utmSource: 'old', utmCampaign: 'c1' });
    if (!r.ok) throw new Error('setup');
    let link = (await getUserLink(u.id, r.link.id))!;
    expect(toLinkDto(link).utm).toEqual({ source: 'old', medium: null, campaign: 'c1', term: null, content: null });

    expect(await applyLinkPatch(link, linkPatchSchema.parse({ utmSource: 'new', utmMedium: 'email', utmCampaign: null }))).toBeNull();
    link = (await getUserLink(u.id, r.link.id))!;
    const dto = toLinkDto(link);
    expect(dto.utm).toEqual({ source: 'new', medium: 'email', campaign: null, term: null, content: null });
    const dest = new URL(dto.url);
    expect(dest.searchParams.get('utm_source')).toBe('new');
    expect(dest.searchParams.get('utm_medium')).toBe('email');
    expect(dest.searchParams.has('utm_campaign')).toBe(false);
  });

  it('cambiar la URL re-deriva las columnas utm_*', async () => {
    const u = await makeUser('utm2');
    const r = await createLink(u.id, { url: 'https://example.com/p', slug: slug('uu'), utmSource: 'old' });
    if (!r.ok) throw new Error('setup');
    let link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ url: 'https://example.com/q?utm_campaign=spring' }))).toBeNull();
    link = (await getUserLink(u.id, r.link.id))!;
    expect(toLinkDto(link).utm).toEqual({ source: null, medium: null, campaign: 'spring', term: null, content: null });

    // Una URL que ya trae utm_* al crear también queda reflejada.
    const pre = await createLink(u.id, { url: 'https://example.com/?utm_medium=cpc', slug: slug('up') });
    if (!pre.ok) throw new Error('setup');
    expect(toLinkDto(pre.link).utm.medium).toBe('cpc');
  });
});

describe('Link: redirect de links vencidos e inexistentes', () => {
  it('un link vencido o sin clicks va a su expired_url', async () => {
    const u = await makeUser('exp');
    const past = new Date(Date.now() - 60_000).toISOString();
    const r = await createLink(u.id, {
      url: 'https://example.com/promo',
      slug: slug('ex'),
      expiresAt: past,
      expiredUrl: 'https://example.com/promo-ended',
    });
    if (!r.ok) throw new Error('setup');
    expect(toLinkDto(r.link).expired_url).toBe('https://example.com/promo-ended');
    const res = await visit(r.link.slug);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/promo-ended');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const lim = await createLink(u.id, { url: 'https://example.com/x', slug: slug('el'), maxClicks: 1, expiredUrl: 'example.com/full' });
    if (!lim.ok) throw new Error('setup');
    await getDb().prepare('UPDATE links SET clicks = 1 WHERE id = ?').run(lim.link.id);
    expect((await visit(lim.link.slug)).headers.get('location')).toBe('https://example.com/full');
  });

  it('sin expired_url sigue yendo a /gone', async () => {
    const u = await makeUser('exp2');
    const r = await createLink(u.id, { url: 'https://example.com/a', slug: slug('eg'), expiresAt: new Date(Date.now() - 1000).toISOString() });
    if (!r.ok) throw new Error('setup');
    expect((await visit(r.link.slug)).headers.get('location')).toBe('http://localhost:3000/en/gone?reason=expired');
    expect((await visit(slug('missing'))).headers.get('location')).toBe('http://localhost:3000/en/gone?reason=notfound');
  });

  it('valida expired_url: http(s) y sin loops a otro link corto', async () => {
    const u = await makeUser('exp3');
    expect(await createLink(u.id, { url: 'https://example.com/a', expiredUrl: 'javascript:alert(1)' })).toEqual({
      ok: false,
      code: 'invalid_expired_url',
    });
    expect(await createLink(u.id, { url: 'https://example.com/a', expiredUrl: 'http://localhost:3000/r/abc123' })).toEqual({
      ok: false,
      code: 'self_link',
    });
    const r = await createLink(u.id, { url: 'https://example.com/a', slug: slug('ev'), expiredUrl: 'https://example.com/e' });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ expiredUrl: 'ftp://x' }))).toEqual({
      error: 'invalid_expired_url',
      status: 400,
    });
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ expiredUrl: null }))).toBeNull();
    expect((await getUserLink(u.id, r.link.id))!.expired_url).toBeNull();
  });

  it('en un dominio propio usa not_found_url y el expired_url del dominio como default', async () => {
    const u = await makeUser('dom');
    const d = await verifiedDomain(u.id, { not_found_url: 'https://acme.example/404', expired_url: 'https://acme.example/ended' });
    expect((await visit(slug('nope'), { host: d.hostname })).headers.get('location')).toBe('https://acme.example/404');

    const past = new Date(Date.now() - 1000).toISOString();
    const plain = await createLink(u.id, { url: 'https://example.com/a', slug: slug('dp'), domainId: d.id, expiresAt: past });
    const own = await createLink(u.id, {
      url: 'https://example.com/b',
      slug: slug('do'),
      domainId: d.id,
      expiresAt: past,
      expiredUrl: 'https://acme.example/own',
    });
    if (!plain.ok || !own.ok) throw new Error('setup');
    expect((await visit(plain.link.slug, { host: d.hostname })).headers.get('location')).toBe('https://acme.example/ended');
    expect((await visit(own.link.slug, { host: d.hostname })).headers.get('location')).toBe('https://acme.example/own');

    // Archivado cuenta como inexistente.
    const arch = await createLink(u.id, { url: 'https://example.com/c', slug: slug('da'), domainId: d.id });
    if (!arch.ok) throw new Error('setup');
    await getDb().prepare('UPDATE links SET archived = 1 WHERE id = ?').run(arch.link.id);
    expect((await visit(arch.link.slug, { host: d.hostname })).headers.get('location')).toBe('https://acme.example/404');
  });

  it('el PATCH del dominio guarda los tres redirects y frena loops', async () => {
    const u = await makeUser('domp');
    const d = await verifiedDomain(u.id);
    session.user = { id: u.id, role: 'owner' };
    const patch = (body: unknown) =>
      domainRoute.PATCH(
        new NextRequest('http://localhost:3000/api/links/domains/x', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: d.id }) },
      );
    expect((await patch({ notFoundUrl: 'https://acme.example/404', expiredUrl: 'https://acme.example/ended' })).status).toBe(200);
    const row = (await getDb().prepare('SELECT root_url, not_found_url, expired_url FROM link_domains WHERE id = ?').get(d.id)) as Record<
      string,
      string | null
    >;
    expect(row).toEqual({ root_url: null, not_found_url: 'https://acme.example/404', expired_url: 'https://acme.example/ended' });
    expect((await patch({ notFoundUrl: 'http://localhost:3000/r/abc123' })).status).toBe(400);
    expect((await patch({ expiredUrl: null })).status).toBe(200);
    const after = (await getDb().prepare('SELECT not_found_url, expired_url FROM link_domains WHERE id = ?').get(d.id)) as Record<
      string,
      string | null
    >;
    expect(after).toEqual({ not_found_url: 'https://acme.example/404', expired_url: null });
  });
});
