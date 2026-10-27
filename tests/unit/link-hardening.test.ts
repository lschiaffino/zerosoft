import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  applyLinkPatch,
  createLink,
  getUserLink,
  isShortLinkUrl,
  linkPatchSchema,
  linkStatus,
} from '@/lib/links';
import { clicksToCsv, contextFromHeaders, exportClicks, getAnalytics, isBotRequest, recordClick } from '@/lib/track';
import { makeUser } from './helpers';

// DNS controlado: el TXT de propiedad y el CNAME del dominio propio.
const dns = vi.hoisted(() => ({
  txt: new Map<string, string[][]>(),
  cname: new Map<string, string[]>(),
}));
vi.mock('dns/promises', () => ({
  resolveTxt: async (name: string) => {
    const r = dns.txt.get(name);
    if (!r) throw new Error('ENOTFOUND');
    return r;
  },
  resolveCname: async (name: string) => {
    const r = dns.cname.get(name);
    if (!r) throw new Error('ENOTFOUND');
    return r;
  },
  lookup: async () => [],
}));
// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');
const socialRoute = await import('@/app/s/[slug]/route');
const { addDomain, verifyDomain, listDomains } = await import('@/lib/link-domains');

const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const SLACK = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const FACEBOOK = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

function req(path: string, opts: { ua?: string; method?: string } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? 'GET',
    headers: { host: 'localhost:3000', 'user-agent': opts.ua ?? DESKTOP },
  });
}
const visit = (s: string, opts: { ua?: string; method?: string; qr?: boolean } = {}) =>
  redirectRoute.GET(req(`/r/${s}${opts.qr ? '?qr=1' : ''}`, opts), { params: Promise.resolve({ slug: s }) });

async function clicksOf(id: string): Promise<number> {
  return ((await getDb().prepare('SELECT clicks FROM links WHERE id = ?').get(id)) as { clicks: number }).clicks;
}

describe('Link: bots y previews no cuentan como clicks', () => {
  it('detecta unfurlers, crawlers y HEAD; un navegador no es bot', () => {
    const h = (ua: string) => new Headers({ 'user-agent': ua });
    for (const ua of [WHATSAPP, SLACK, FACEBOOK, 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'Discordbot/2.0', 'LinkedInBot/1.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)']) {
      expect(isBotRequest(h(ua)), ua).toBe(true);
    }
    expect(isBotRequest(h(DESKTOP))).toBe(false);
    expect(isBotRequest(h(DESKTOP), 'HEAD')).toBe(true);
  });

  it('un link de un solo uso sobrevive al preview de WhatsApp/Slack y al HEAD', async () => {
    const u = await makeUser('bot');
    const r = await createLink(u.id, { url: 'https://example.com/once', slug: slug('one'), maxClicks: 1 });
    if (!r.ok) throw new Error('setup');

    for (const ua of [WHATSAPP, SLACK, FACEBOOK]) {
      const res = await visit(r.link.slug, { ua });
      expect(res.headers.get('location')).toBe('https://example.com/once');
    }
    await visit(r.link.slug, { method: 'HEAD' });
    expect(await clicksOf(r.link.id)).toBe(0);
    expect((await getDb().prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ?').get(r.link.id)) as { c: number }).toEqual({ c: 0 });

    // La persona destinataria entra; después, se agotó.
    expect((await visit(r.link.slug)).headers.get('location')).toBe('https://example.com/once');
    expect(await clicksOf(r.link.id)).toBe(1);
    expect((await visit(r.link.slug)).headers.get('location')).toContain('/gone?reason=limit');
  });

  it('con tarjeta OG propia, el bot recibe el HTML OG sin contar', async () => {
    const u = await makeUser('og');
    const r = await createLink(u.id, { url: 'https://example.com/og', slug: slug('og'), ogTitle: 'Promo <b>' });
    if (!r.ok) throw new Error('setup');
    const res = await visit(r.link.slug, { ua: SLACK });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('og:title" content="Promo &lt;b&gt;"');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(await clicksOf(r.link.id)).toBe(0);
  });
});

describe('Link: /s no saltea el conteo', () => {
  it('una persona en /s va a /r (cuenta y respeta el límite); un bot ve la tarjeta', async () => {
    const u = await makeUser('s');
    const r = await createLink(u.id, { url: 'https://example.com/s', slug: slug('s'), maxClicks: 1 });
    if (!r.ok) throw new Error('setup');
    const params = { params: Promise.resolve({ slug: r.link.slug }) };

    const human = await socialRoute.GET(req(`/s/${r.link.slug}?qr=1`), params);
    expect(human.headers.get('location')).toBe(`http://localhost:3000/r/${r.link.slug}?qr=1`);

    const bot = await socialRoute.GET(req(`/s/${r.link.slug}`, { ua: FACEBOOK }), params);
    expect(bot.status).toBe(200);
    const html = await bot.text();
    expect(html).toContain('og:url');
    expect(html).not.toContain('window.location.replace');
    expect(await clicksOf(r.link.id)).toBe(0);
  });
});

describe('Link: max_clicks atómico', () => {
  it('requests concurrentes no pasan el límite', async () => {
    const u = await makeUser('race');
    const r = await createLink(u.id, { url: 'https://example.com/race', slug: slug('race'), maxClicks: 3 });
    if (!r.ok) throw new Error('setup');
    const ctx = contextFromHeaders(new Headers({ 'user-agent': DESKTOP }));
    const results = await Promise.all(Array.from({ length: 8 }, () => recordClick(r.link.id, ctx)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await clicksOf(r.link.id)).toBe(3);
    const rows = (await getDb().prepare('SELECT COUNT(*) AS c FROM clicks WHERE link_id = ?').get(r.link.id)) as { c: number };
    expect(rows.c).toBe(3);
  });

  it('linkStatus marca "limit" cuando se llegó a max_clicks', async () => {
    const u = await makeUser('st');
    const r = await createLink(u.id, { url: 'https://example.com/st', slug: slug('st'), maxClicks: 1, password: 'x' });
    if (!r.ok) throw new Error('setup');
    expect(linkStatus(r.link)).toBe('protected');
    expect(linkStatus({ ...r.link, clicks: 1 })).toBe('limit');
  });
});

describe('Link: la puerta de contraseña conserva ?qr=1', () => {
  it('el redirect a /gate lleva qr=1', async () => {
    const u = await makeUser('gate');
    const r = await createLink(u.id, { url: 'https://example.com/g', slug: slug('g'), password: 'pw' });
    if (!r.ok) throw new Error('setup');
    const res = await visit(r.link.slug, { qr: true });
    expect(res.headers.get('location')).toBe(`http://localhost:3000/en/gate/${r.link.slug}?qr=1`);
    const plain = await visit(r.link.slug);
    expect(plain.headers.get('location')).toBe(`http://localhost:3000/en/gate/${r.link.slug}`);
  });
});

describe('Link: renombrar el slug respeta el dominio', () => {
  it('en un dominio propio admite reservados y slugs usados en otro dominio', async () => {
    const u = await makeUser('ren');
    const other = await makeUser('ren2');
    const domainId = crypto.randomUUID();
    await getDb()
      .prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)')
      .run(domainId, u.id, `go-${domainId.slice(0, 8)}.example.com`);
    const taken = slug('pr');
    const onDefault = await createLink(other.id, { url: 'https://example.com/x', slug: taken });
    const onCustom = await createLink(u.id, { url: 'https://example.com/y', slug: slug('cu'), domainId });
    const sibling = await createLink(u.id, { url: 'https://example.com/z', slug: slug('sb'), domainId });
    if (!onDefault.ok || !onCustom.ok || !sibling.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, onCustom.link.id))!;

    expect(await applyLinkPatch(link, linkPatchSchema.parse({ slug: taken }))).toBeNull();
    const renamed = (await getUserLink(u.id, onCustom.link.id))!;
    expect(await applyLinkPatch(renamed, linkPatchSchema.parse({ slug: 'blog' }))).toBeNull();
    const again = (await getUserLink(u.id, onCustom.link.id))!;
    expect(await applyLinkPatch(again, linkPatchSchema.parse({ slug: sibling.link.slug }))).toEqual({
      error: 'slug_taken',
      status: 409,
    });
    // En el dominio por defecto, 'blog' sigue reservado.
    const def = (await getUserLink(other.id, onDefault.link.id))!;
    expect(await applyLinkPatch(def, linkPatchSchema.parse({ slug: 'blog' }))).toEqual({ error: 'invalid_slug', status: 400 });
  });
});

describe('Link: abuso', () => {
  const prevQuota = process.env.LINK_DAILY_QUOTA;
  afterEach(() => {
    if (prevQuota === undefined) delete process.env.LINK_DAILY_QUOTA;
    else process.env.LINK_DAILY_QUOTA = prevQuota;
  });

  it('rechaza destinos que son links cortos nuestros (loops), al crear y al editar', async () => {
    const u = await makeUser('loop');
    expect(await isShortLinkUrl('http://localhost:3000/abc123')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/r/abc123')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/blog')).toBe(false);
    expect(await isShortLinkUrl('http://localhost:3000/blog/post')).toBe(false);
    expect(await isShortLinkUrl('https://example.com/abc123')).toBe(false);

    expect(await createLink(u.id, { url: 'http://localhost:3000/loop12' })).toEqual({ ok: false, code: 'self_link' });
    const r = await createLink(u.id, { url: 'https://example.com/ok' });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ url: `http://localhost:3000/${r.link.slug}` }))).toEqual({
      error: 'self_link',
      status: 400,
    });
  });

  it('tope diario de links por workspace', async () => {
    process.env.LINK_DAILY_QUOTA = '2';
    const u = await makeUser('quota');
    expect((await createLink(u.id, { url: 'https://example.com/1' })).ok).toBe(true);
    expect((await createLink(u.id, { url: 'https://example.com/2' })).ok).toBe(true);
    expect(await createLink(u.id, { url: 'https://example.com/3' })).toEqual({ ok: false, code: 'quota_exceeded' });
  });
});

describe('Link: resultados de la segmentación', () => {
  it('getAnalytics agrupa por variante y el CSV por link la incluye', async () => {
    const u = await makeUser('var');
    const r = await createLink(u.id, { url: 'https://example.com/v', slug: slug('v') });
    if (!r.ok) throw new Error('setup');
    const ctx = contextFromHeaders(new Headers({ 'user-agent': DESKTOP }));
    await recordClick(r.link.id, ctx, { variant: 'ab:A' });
    await recordClick(r.link.id, ctx, { variant: 'ab:A' });
    await recordClick(r.link.id, ctx, { variant: 'ab:B' });
    await recordClick(r.link.id, ctx);
    const a = await getAnalytics(r.link.id, r.link.created_at, '7d');
    expect(a.rangeTotal).toBe(4);
    expect(a.variants).toEqual([
      { name: 'ab:A', count: 2 },
      { name: 'ab:B', count: 1 },
      { name: 'default', count: 1 },
    ]);
    const csv = clicksToCsv(await exportClicks(r.link.id, r.link.created_at, { range: '7d' }));
    expect(csv.split('\n')[0]).toBe('timestamp,country,referrer,device,browser,os,source,variant,region,city,referrer_url');
    expect(csv).toContain(',link,ab:B,');
  });
});

describe('Link: dominios propios exigen probar la propiedad', () => {
  it('sin el TXT no se verifica aunque el CNAME apunte a nosotros', async () => {
    const u = await makeUser('dom');
    const host = `go-${crypto.randomUUID().slice(0, 8)}.example.org`;
    const added = await addDomain(u.id, host);
    if (!added.ok) throw new Error(added.code);
    expect(added.domain.verify_token).toMatch(/^[a-f0-9]{32}$/);

    dns.cname.set(host, ['zerosoft.ai.']);
    expect(await verifyDomain(u.id, added.domain.id)).toEqual({ verified: false, reason: 'txt_missing' });

    dns.txt.set(`_zerosoft-verify.${host}`, [['zerosoft-verify=otro']]);
    expect((await verifyDomain(u.id, added.domain.id)).verified).toBe(false);

    dns.txt.set(`_zerosoft-verify.${host}`, [[`zerosoft-verify=${added.domain.verify_token}`]]);
    expect(await verifyDomain(u.id, added.domain.id)).toEqual({ verified: true, reason: undefined });
    expect((await listDomains(u.id))[0].verified).toBe(1);
  });

  it('un alta sin verificar vieja se libera para otro workspace', async () => {
    const squatter = await makeUser('sq');
    const owner = await makeUser('own');
    const host = `go-${crypto.randomUUID().slice(0, 8)}.example.org`;
    const first = await addDomain(squatter.id, host);
    if (!first.ok) throw new Error(first.code);
    // Pendiente vigente de otro workspace: solo se toma probando el TXT (se devuelve el registro).
    expect(await addDomain(owner.id, host)).toMatchObject({ ok: false, code: 'domain_pending_elsewhere' });

    await getDb()
      .prepare(`UPDATE link_domains SET created_at = datetime('now', '-8 days') WHERE id = ?`)
      .run(first.domain.id);
    const second = await addDomain(owner.id, host);
    expect(second.ok).toBe(true);
  });
});
