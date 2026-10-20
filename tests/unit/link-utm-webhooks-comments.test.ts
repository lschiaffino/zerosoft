import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import {
  applyLinkPatch,
  bulkLinkAction,
  createLink,
  deleteLink,
  duplicateLink,
  getUserLink,
  getUserLinkByRef,
  linkCreators,
  linkPatchSchema,
  listLinks,
  toLinkDto,
} from '@/lib/links';
import { cleanReferrerUrl, readUtm, syncUtm } from '@/lib/link-url';
import { contextFromHeaders, decodeGeoHeader, exportClicks, clicksToCsv, getAnalytics, recordClick, splitCityKey } from '@/lib/track';
import { breakdownLabelers } from '@/lib/link-labels';
import { linkScopeOf, matchesLinkFilter, normalizeLinkFilter, parseLinkFilter } from '@/lib/webhooks-events';
import { addLinkComment, deleteLinkComment, listLinkComments } from '@/lib/link-comments';
import { createUtmTemplate, deleteUtmTemplate, listUtmTemplates, utmTemplateSchema } from '@/lib/link-utm-templates';
import { seal } from '@/lib/secret-box';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role !== 'member',
}));

const v1Links = await import('@/app/api/v1/links/route');
const v1Link = await import('@/app/api/v1/links/[id]/route');
const appLinks = await import('@/app/api/links/route');
const duplicateRoute = await import('@/app/api/links/[id]/duplicate/route');
const commentsRoute = await import('@/app/api/links/[id]/comments/route');
const commentRoute = await import('@/app/api/links/[id]/comments/[commentId]/route');
const templatesRoute = await import('@/app/api/links/utm-templates/route');
const webhooksRoute = await import('@/app/api/webhooks/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Webhook directo en la base (sin pasar por la validación de URL pública): las entregas quedan registradas. */
async function hook(userId: string, events: string[], filters: unknown = null): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, filters) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'https://127.0.0.1/hook', JSON.stringify(events), seal('whsec_test'), filters ? JSON.stringify(filters) : null);
  return id;
}

async function deliveries(hookId: string): Promise<Array<{ event: string; payload: Record<string, unknown> }>> {
  const rows = (await getDb()
    .prepare('SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid')
    .all(hookId)) as Array<{ event: string; payload: string }>;
  return rows.map((r) => ({ event: r.event, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

describe('Link: utm_term, utm_content y plantillas', () => {
  it('syncUtm y readUtm manejan los cinco utm_*', () => {
    const out = syncUtm('https://example.com/p?x=1', { term: 'zapatillas', content: 'banner' });
    expect(out.utm).toEqual({ source: null, medium: null, campaign: null, term: 'zapatillas', content: 'banner' });
    expect(readUtm(syncUtm(out.url, { content: '' }).url).content).toBeNull();
  });

  it('crear y editar con utm_term/utm_content reescribe URL y columnas', async () => {
    const u = await makeUser('utmt');
    const r = await createLink(u.id, { url: 'https://example.com/a', slug: slug('ut'), utmTerm: 'shoes', utmContent: 'hero' });
    if (!r.ok) throw new Error(r.code);
    let link = (await getUserLink(u.id, r.link.id))!;
    expect(toLinkDto(link).utm).toMatchObject({ term: 'shoes', content: 'hero' });
    expect(new URL(link.url).searchParams.get('utm_term')).toBe('shoes');

    expect(await applyLinkPatch(link, linkPatchSchema.parse({ utmTerm: null, utmContent: 'footer' }))).toBeNull();
    link = (await getUserLink(u.id, r.link.id))!;
    expect(toLinkDto(link).utm).toMatchObject({ term: null, content: 'footer' });
    expect(new URL(link.url).searchParams.has('utm_term')).toBe(false);
  });

  it('plantillas: nombre único por workspace, al menos un campo, borra el autor o un admin', async () => {
    const owner = await makeUser('tpo');
    const other = await makeUser('tpx');
    expect(utmTemplateSchema.safeParse({ name: 'Vacía' }).success).toBe(false);
    const a = await createUtmTemplate(owner.id, utmTemplateSchema.parse({ name: 'Newsletter', source: 'news', medium: 'email' }), owner.id);
    if (!a.ok) throw new Error(a.code);
    expect(a.template.utm).toEqual({ source: 'news', medium: 'email', campaign: null, term: null, content: null });
    const dup = await createUtmTemplate(owner.id, utmTemplateSchema.parse({ name: 'Newsletter', source: 'x' }), owner.id);
    expect(dup).toEqual({ ok: false, code: 'name_taken' });
    // Otro workspace no ve ni borra la plantilla.
    expect(await listUtmTemplates(other.id)).toEqual([]);
    expect(await deleteUtmTemplate(other.id, a.template.id, other.id, true)).toBe('not_found');
    expect(await deleteUtmTemplate(owner.id, a.template.id, 'someone-else', false)).toBe('forbidden');
    expect(await deleteUtmTemplate(owner.id, a.template.id, 'someone-else', true)).toBe('ok');
  });

  it('ruta de plantillas: 401 sin sesión, 201 al crear, 409 repetida', async () => {
    const u = await makeUser('tpr');
    const req = (body: unknown) => new NextRequest('http://x/api/links/utm-templates', { method: 'POST', body: JSON.stringify(body) });
    expect((await templatesRoute.POST(req({ name: 'A', source: 's' }))).status).toBe(401);
    session.user = { ...u, role: 'owner' };
    expect((await templatesRoute.POST(req({ name: 'A', source: 's' }))).status).toBe(201);
    expect((await templatesRoute.POST(req({ name: 'A', source: 's' }))).status).toBe(409);
    const empty = await templatesRoute.POST(req({ name: 'B' }));
    expect(((await empty.json()) as { error: string }).error).toBe('empty_template');
    const list = (await (await templatesRoute.GET()).json()) as { templates: Array<{ name: string }> };
    expect(list.templates.map((t) => t.name)).toEqual(['A']);
  });
});

describe('Link: webhooks link.updated / link.deleted y filtro de links', () => {
  it('normaliza y aplica el filtro (AND entre listas, OR dentro de cada una)', () => {
    expect(normalizeLinkFilter({ linkIds: [], tags: [' '], domains: [] })).toBeNull();
    const f = normalizeLinkFilter({ linkIds: ['a', 'a'], tags: ['promo'], domains: ['GO.Acme.com', ''] })!;
    expect(f).toEqual({ linkIds: ['a'], tags: ['promo'], domains: ['go.acme.com', ''] });
    expect(matchesLinkFilter(f, { id: 'a', tags: ['promo', 'x'], domain: null })).toBe(true);
    expect(matchesLinkFilter(f, { id: 'a', tags: ['promo'], domain: 'go.acme.com' })).toBe(true);
    expect(matchesLinkFilter(f, { id: 'b', tags: ['promo'], domain: null })).toBe(false);
    expect(matchesLinkFilter(f, { id: 'a', tags: [], domain: null })).toBe(false);
    expect(matchesLinkFilter(f, { id: 'a', tags: ['promo'], domain: 'other.com' })).toBe(false);
    expect(matchesLinkFilter(null, null)).toBe(true);
    expect(matchesLinkFilter(f, null)).toBe(false);
    expect(parseLinkFilter('no json')).toBeNull();
    expect(linkScopeOf({ link: { id: 'x', tags: ['t', 3], domain: null } })).toEqual({ id: 'x', tags: ['t'], domain: null });
  });

  it('editar, archivar en masa y borrar emiten link.updated / link.deleted', async () => {
    const u = await makeUser('whu');
    const all = await hook(u.id, ['link.updated', 'link.deleted']);
    const r = await createLink(u.id, { url: 'https://example.com/w', slug: slug('wh'), tags: ['promo'] });
    if (!r.ok) throw new Error(r.code);
    const link = (await getUserLink(u.id, r.link.id))!;

    expect(await applyLinkPatch(link, linkPatchSchema.parse({ title: 'Nuevo' }))).toBeNull();
    // Un PATCH sin cambios no emite nada.
    expect(await applyLinkPatch(link, linkPatchSchema.parse({}))).toBeNull();
    expect(await bulkLinkAction(u.id, { action: 'archive', ids: [link.id] })).toBe(1);
    // Archivar lo ya archivado no vuelve a emitir.
    await bulkLinkAction(u.id, { action: 'archive', ids: [link.id] });
    await deleteLink((await getUserLink(u.id, link.id))!);

    const got = await deliveries(all);
    expect(got.map((d) => d.event)).toEqual(['link.updated', 'link.updated', 'link.deleted']);
    const first = got[0].payload.data as { link: { id: string; title: string }; changes: string[] };
    expect(first.link.title).toBe('Nuevo');
    expect(first.changes).toEqual(['title']);
    expect((got[1].payload.data as { changes: string[] }).changes).toEqual(['archived']);
    expect((got[2].payload.data as { link: { id: string } }).link.id).toBe(link.id);
    expect(await getUserLink(u.id, link.id)).toBeUndefined();
  });

  it('un webhook filtrado por tag solo recibe los eventos de esos links; los demás eventos no se filtran', async () => {
    const u = await makeUser('whf');
    const scoped = await hook(u.id, ['link.updated', 'contact.created'], { linkIds: [], tags: ['promo'], domains: [] });
    const a = await createLink(u.id, { url: 'https://example.com/a', slug: slug('wa'), tags: ['promo'] });
    const b = await createLink(u.id, { url: 'https://example.com/b', slug: slug('wb'), tags: ['otro'] });
    if (!a.ok || !b.ok) throw new Error('setup');
    await applyLinkPatch((await getUserLink(u.id, a.link.id))!, linkPatchSchema.parse({ title: 'A' }));
    await applyLinkPatch((await getUserLink(u.id, b.link.id))!, linkPatchSchema.parse({ title: 'B' }));
    const { emitWebhook } = await import('@/lib/webhooks');
    await emitWebhook(u.id, 'contact.created', { id: 'c1' });
    const got = await deliveries(scoped);
    expect(got.map((d) => d.event)).toEqual(['link.updated', 'contact.created']);
    expect((got[0].payload.data as { link: { id: string } }).link.id).toBe(a.link.id);
  });

  it('la ruta de webhooks resuelve slugs del filtro y rechaza links que no existen', async () => {
    const u = await makeUser('whr');
    const r = await createLink(u.id, { url: 'https://example.com/r', slug: slug('wr') });
    if (!r.ok) throw new Error(r.code);
    session.user = { ...u, role: 'owner' };
    const post = (linkFilter: unknown) =>
      webhooksRoute.POST(
        new NextRequest('http://x/api/webhooks', {
          method: 'POST',
          body: JSON.stringify({ url: 'https://127.0.0.1/hook', events: ['link.clicked'], linkFilter }),
        }),
      );
    const bad = await post({ links: ['no-existe-xyz'] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('unknown_link');
  });
});

describe('Link: API v1 con UTM, vencimiento, contraseña, OG, segmentación y externalId', () => {
  it('crea con todo, devuelve el DTO completo y se lee por ext_<id>', async () => {
    const u = await makeUser('v1x');
    const { key } = await createApiKey(u.id, 'k', u.id, ['links:read', 'links:write']);
    const post = (body: unknown) =>
      v1Links.POST(
        new NextRequest('http://x/api/v1/links', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        }),
      );
    const res = await post({
      url: 'https://example.com/landing',
      slug: slug('v1'),
      utmSource: 'news',
      utmTerm: 'shoes',
      utmContent: 'hero',
      expiresAt: '2099-01-01T00:00:00Z',
      maxClicks: 10,
      password: 'secreto',
      redirectType: 301,
      ogTitle: 'Título',
      ogImage: 'https://example.com/og.png',
      targeting: { rules: [{ countries: ['AR'], devices: [], url: 'https://example.com/ar' }], ab: [] },
      externalId: 'crm-42',
    });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as ReturnType<typeof toLinkDto> & { password_hash?: string };
    expect(dto.utm).toMatchObject({ source: 'news', term: 'shoes', content: 'hero' });
    expect(dto.has_password).toBe(true);
    expect(dto.password_hash).toBeUndefined();
    expect(dto.max_clicks).toBe(10);
    expect(dto.redirect_type).toBe(301);
    expect(dto.og.image).toBe('https://example.com/og.png');
    expect(dto.targeting?.rules).toHaveLength(1);
    expect(dto.external_id).toBe('crm-42');
    expect(dto.created_by).toBe(u.id);

    const again = await post({ url: 'https://example.com/otra', externalId: 'crm-42' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } } | { error: string })).toBeTruthy();

    expect((await post({ url: 'https://example.com/x', ogImage: 'javascript:alert(1)' })).status).toBe(400);
    expect((await post({ url: 'https://example.com/x', externalId: 'con espacios' })).status).toBe(400);
    expect((await post({ url: 'https://example.com/x', targeting: { rules: [{ countries: [], devices: [], url: 'https://e.com' }] } })).status).toBe(400);
    expect((await post({ url: 'https://example.com/x', expiresAt: 'mañana' })).status).toBe(400);

    const byExt = await v1Link.GET(new NextRequest('http://x/api/v1/links/ext_crm-42', { headers: { authorization: `Bearer ${key}` } }), {
      params: Promise.resolve({ id: 'ext_crm-42' }),
    });
    expect(byExt.status).toBe(200);
    expect(((await byExt.json()) as { id: string }).id).toBe(dto.id);
    expect((await getUserLinkByRef(u.id, 'ext_nope'))?.id).toBeUndefined();
  });
});

describe('Link: quién creó cada link', () => {
  it('guarda el creador real (no el owner del team) y filtra por creador', async () => {
    const owner = await makeUser('own');
    const member = await makeUser('mem');
    session.user = { ...owner, actingUser: member, role: 'member' };
    const res = await appLinks.POST(
      new NextRequest('http://x/api/links', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/m', slug: slug('cm') }) }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; created_by: string };
    expect(created.created_by).toBe(member.id);
    await createLink(owner.id, { url: 'https://example.com/o', createdBy: owner.id });

    const mine = await listLinks(owner.id, { creator: member.id });
    expect(mine.links.map((l) => l.id)).toEqual([created.id]);
    expect((await linkCreators(owner.id)).map((c) => c.id).sort()).toEqual([member.id, owner.id].sort());
  });
});

describe('Link: ciudad, región y URL del referrer', () => {
  it('limpia la URL del referrer: sin hash ni query salvo utm_*', () => {
    expect(cleanReferrerUrl('https://news.site/a/b?token=abc&utm_source=x#top')).toBe('https://news.site/a/b?utm_source=x');
    expect(cleanReferrerUrl('https://user:pw@site.com/p?q=1')).toBe('https://site.com/p');
    expect(cleanReferrerUrl('android-app://com.slack')).toBeNull();
    expect(cleanReferrerUrl('no es url')).toBeNull();
    expect(cleanReferrerUrl(null)).toBeNull();
  });

  it('en Vercel lee ciudad (URL-encoded) y región de los headers', () => {
    vi.stubEnv('VERCEL', '1');
    const ctx = contextFromHeaders(
      new Headers({
        'user-agent': DESKTOP,
        referer: 'https://www.blog.com/post?id=9&utm_medium=social',
        'x-vercel-ip-country': 'BR',
        'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
        'x-vercel-ip-country-region': 'SP',
      }),
    );
    expect(ctx).toMatchObject({ country: 'BR', city: 'São Paulo', region: 'SP', referrer: 'blog.com' });
    expect(ctx.referrerUrl).toBe('https://www.blog.com/post?utm_medium=social');
    expect(decodeGeoHeader('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeGeoHeader('  ')).toBeNull();
  });

  it('guarda y desglosa ciudad, región y URL del referrer; el CSV las incluye', async () => {
    const u = await makeUser('geo');
    const r = await createLink(u.id, { url: 'https://example.com/g', slug: slug('ge') });
    if (!r.ok) throw new Error(r.code);
    const base = { referrer: 'blog.com', device: 'desktop', browser: 'Chrome', os: 'Mac OS' };
    await recordClick(r.link.id, { ...base, referrerUrl: 'https://blog.com/a', country: 'AR', city: 'Córdoba', region: 'X' });
    await recordClick(r.link.id, { ...base, referrerUrl: 'https://blog.com/a', country: 'ES', city: 'Córdoba', region: 'AN' });
    await recordClick(r.link.id, { ...base, referrerUrl: null, country: 'AR', city: null, region: null });
    const a = await getAnalytics(r.link.id, r.link.created_at, '7d');
    expect(a.cities).toEqual(
      expect.arrayContaining([
        { name: 'Córdoba|AR', count: 1 },
        { name: 'Córdoba|ES', count: 1 },
        { name: 'unknown', count: 1 },
      ]),
    );
    expect(a.regions).toEqual(expect.arrayContaining([{ name: 'AR-X', count: 1 }]));
    expect(a.referrerUrls[0]).toEqual({ name: 'https://blog.com/a', count: 2 });
    expect(splitCityKey('Córdoba|AR')).toEqual({ city: 'Córdoba', country: 'AR' });

    const labels = breakdownLabelers('en', {
      direct: 'Direct',
      other: 'Other',
      unknown: 'Unknown',
      variantDefault: 'Default',
      device: { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' },
      rule: (n) => n,
      ab: (v) => v,
      app: (os) => os,
    });
    expect(labels.city('Córdoba|AR')).toBe('Córdoba, Argentina');
    expect(labels.region('US-CA')).toBe('CA, United States');
    expect(labels.city('unknown')).toBe('Unknown');

    const csv = clicksToCsv(await exportClicks(r.link.id, r.link.created_at, { range: '7d' }));
    expect(csv).toContain(',X,Córdoba,https://blog.com/a');
  });
});

describe('Link: comentarios internos y duplicar', () => {
  it('comentarios: crear, listar, solo el autor o un admin borran, otro workspace no ve nada', async () => {
    const owner = await makeUser('cmo');
    const member = await makeUser('cmm');
    const stranger = await makeUser('cms');
    const r = await createLink(owner.id, { url: 'https://example.com/c', slug: slug('cc') });
    if (!r.ok) throw new Error(r.code);
    const c = await addLinkComment(r.link.id, owner.id, '  campaña de marzo  ');
    expect(c.body).toBe('campaña de marzo');
    expect(c.authorName).toBe('cmo');
    expect(await deleteLinkComment(r.link.id, c.id, member.id, false)).toBe('forbidden');

    session.user = { ...stranger, role: 'owner' };
    const params = { params: Promise.resolve({ id: r.link.id }) };
    expect((await commentsRoute.GET(new NextRequest('http://x'), params)).status).toBe(404);

    session.user = { ...owner, actingUser: member, role: 'member' };
    const post = await commentsRoute.POST(new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ body: 'ok' }) }), params);
    expect(post.status).toBe(201);
    const mine = (await post.json()) as { id: string; authorId: string };
    expect(mine.authorId).toBe(member.id);
    expect((await commentsRoute.POST(new NextRequest('http://x', { method: 'POST', body: JSON.stringify({ body: ' ' }) }), params)).status).toBe(400);
    const del = await commentRoute.DELETE(new NextRequest('http://x'), { params: Promise.resolve({ id: r.link.id, commentId: c.id }) });
    expect(del.status).toBe(403);
    const delMine = await commentRoute.DELETE(new NextRequest('http://x'), { params: Promise.resolve({ id: r.link.id, commentId: mine.id }) });
    expect(delMine.status).toBe(204);
    expect((await listLinkComments(r.link.id)).map((x) => x.id)).toEqual([c.id]);
  });

  it('duplicar copia destino, tags, UTM, contraseña y segmentación con slug nuevo; no copia comentarios ni id externo', async () => {
    const u = await makeUser('dup');
    const r = await createLink(u.id, {
      url: 'https://example.com/d',
      slug: slug('dd'),
      title: 'Original',
      tags: ['promo'],
      utmCampaign: 'q4',
      password: 'pw',
      maxClicks: 5,
      externalId: 'ext-dup',
      targeting: { rules: [], ab: [], ios: { app: 'myapp://x' } },
    });
    if (!r.ok) throw new Error(r.code);
    const original = (await getUserLink(u.id, r.link.id))!;
    await addLinkComment(original.id, u.id, 'nota');
    const copy = await duplicateLink(original, 'other-person');
    if (!copy.ok) throw new Error(copy.code);
    const d = toLinkDto((await getUserLink(u.id, copy.link.id))!);
    expect(d.slug).not.toBe(original.slug);
    expect(d.url).toBe(original.url);
    expect(d.title).toBe('Original');
    expect(d.tags).toEqual(['promo']);
    expect(d.utm.campaign).toBe('q4');
    expect(d.has_password).toBe(true);
    expect(copy.link.password_hash).toBe(original.password_hash);
    expect(d.max_clicks).toBe(5);
    expect(d.targeting?.ios?.app).toBe('myapp://x');
    expect(d.external_id).toBeNull();
    expect(d.created_by).toBe('other-person');
    expect(await listLinkComments(copy.link.id)).toEqual([]);

    session.user = { ...u, role: 'owner' };
    const res = await duplicateRoute.POST(new NextRequest('http://x', { method: 'POST' }), { params: Promise.resolve({ id: original.id }) });
    expect(res.status).toBe(201);
    session.user = { ...(await makeUser('dux')), role: 'owner' };
    const foreign = await duplicateRoute.POST(new NextRequest('http://x', { method: 'POST' }), { params: Promise.resolve({ id: original.id }) });
    expect(foreign.status).toBe(404);
  });
});
