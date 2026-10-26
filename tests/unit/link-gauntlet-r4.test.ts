import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createLink, gateCookieName, gateRefCookieName, gateToken, getUserLink, isShortLinkUrl } from '@/lib/links';
import { isOwnDeploymentHost } from '@/lib/hosts';
import { bulkResultsToCsv } from '@/lib/link-bulk-csv';
import { linkPreviewHtml } from '@/lib/link-preview';
import { breakdownLabelers, type BreakdownMessages } from '@/lib/link-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string }) => u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');
const linksRoute = await import('@/app/api/links/route');
const batchRoute = await import('@/app/api/links/batch/route');
const exportRoute = await import('@/app/api/links/export/route');
const importRoute = await import('@/app/api/links/import/route');
const bioRoute = await import('@/app/api/links/bio/route');
const domainRoute = await import('@/lib/routes/links/domains/[id]/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function jsonReq(path: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.4.${Math.floor(Math.random() * 250)}.1` },
    body: JSON.stringify(body),
  });
}

async function asUser(label: string, role: 'owner' | 'admin' | 'member') {
  const u = await makeUser(label);
  session.user = { ...u, role } as unknown as Record<string, unknown>;
  return u;
}

afterEach(() => {
  session.user = null;
  vi.unstubAllEnvs();
});

describe('Link r4: el anti-loop no se saltea', () => {
  it('un slug codificado en porcentaje sigue siendo un link corto', async () => {
    expect(await isShortLinkUrl('http://localhost:3000/r/%61bcdefg')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/%61bcdefg')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/es/gate/%61bcdefg')).toBe(true);
    // Un % roto no rompe la validación.
    expect(await isShortLinkUrl('http://localhost:3000/r/%E0%A4%A')).toBe(false);
  });

  it('los deployments anteriores del mismo proyecto en Vercel cuentan como propios; otros *.vercel.app no', async () => {
    vi.stubEnv('VERCEL_URL', 'zerosoftware-ai-abc123def-lschiaffino.vercel.app');
    expect(isOwnDeploymentHost('zerosoftware-ai-zz9yy8xx7-lschiaffino.vercel.app')).toBe(true);
    expect(isOwnDeploymentHost('zerosoftware-ai-git-main-lschiaffino.vercel.app')).toBe(true);
    expect(isOwnDeploymentHost('zerosoftware-ai.vercel.app')).toBe(true);
    expect(isOwnDeploymentHost('otra-app.vercel.app')).toBe(false);
    expect(await isShortLinkUrl('https://zerosoftware-ai-zz9yy8xx7-lschiaffino.vercel.app/r/abcdefg')).toBe(true);
    expect(await isShortLinkUrl('https://otra-app.vercel.app/pricing')).toBe(false);
  });

  it('la raíz de un dominio propio verificado arma loop; un path cualquiera no', async () => {
    const u = await makeUser('root');
    const host = `go-${crypto.randomUUID().slice(0, 8)}.example.com`;
    await getDb()
      .prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)')
      .run(crypto.randomUUID(), u.id, host);
    expect(await isShortLinkUrl(`https://${host}/`)).toBe(true);
    expect(await isShortLinkUrl(`https://${host}/abc123`)).toBe(true);
    expect(await isShortLinkUrl(`https://${host}/a/b/c`)).toBe(false);
  });

  it('PATCH de dominios rechaza un rootUrl que vuelve al propio dominio', async () => {
    const u = await asUser('rootp', 'owner');
    const id = crypto.randomUUID();
    const host = `go-${id.slice(0, 8)}.example.com`;
    await getDb()
      .prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)')
      .run(id, u.id, host);
    const loop = await domainRoute.PATCH(jsonReq(`/api/links/domains/${id}`, 'PATCH', { rootUrl: `https://${host}/` }), {
      params: Promise.resolve({ id }),
    });
    expect(loop.status).toBe(400);
    expect(await loop.json()).toEqual({ error: 'self_link' });
    const ok = await domainRoute.PATCH(jsonReq(`/api/links/domains/${id}`, 'PATCH', { rootUrl: 'https://empresa.com/' }), {
      params: Promise.resolve({ id }),
    });
    expect(ok.status).toBe(200);
  });
});

describe('Link r4: operaciones masivas solo para admins', () => {
  it('un member no puede borrar en masa, pero sí archivar', async () => {
    const u = await asUser('bdel', 'member');
    const r = await createLink(u.id, { url: 'https://example.com/bd', slug: slug('bd') });
    if (!r.ok) throw new Error('setup');
    const del = await batchRoute.POST(jsonReq('/api/links/batch', 'POST', { action: 'delete', ids: [r.link.id] }));
    expect(del.status).toBe(403);
    expect(await getUserLink(u.id, r.link.id)).toBeTruthy();
    const arch = await batchRoute.POST(jsonReq('/api/links/batch', 'POST', { action: 'archive', ids: [r.link.id] }));
    expect(arch.status).toBe(200);
  });

  it('un admin sí puede borrar en masa', async () => {
    const u = await asUser('bdela', 'admin');
    const r = await createLink(u.id, { url: 'https://example.com/bd', slug: slug('bd') });
    if (!r.ok) throw new Error('setup');
    const del = await batchRoute.POST(jsonReq('/api/links/batch', 'POST', { action: 'delete', ids: [r.link.id] }));
    expect(del.status).toBe(200);
    expect(await getUserLink(u.id, r.link.id)).toBeFalsy();
  });

  it('export, import y la página bio exigen admin', async () => {
    await asUser('mexp', 'member');
    expect((await exportRoute.GET(new NextRequest('http://localhost:3000/api/links/export'))).status).toBe(403);
    expect((await importRoute.POST(jsonReq('/api/links/import', 'POST', { source: 'bitly', token: 'x' }))).status).toBe(403);
    expect((await bioRoute.PUT(jsonReq('/api/links/bio', 'PUT', { enabled: true }))).status).toBe(403);
  });
});

describe('Link r4: errores de validación del alta', () => {
  it('un título largo es bad_request, no invalid_url', async () => {
    await asUser('val', 'owner');
    const long = await linksRoute.POST(jsonReq('/api/links', 'POST', { url: 'https://example.com', title: 'x'.repeat(250) }));
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'bad_request' });
    const noUrl = await linksRoute.POST(jsonReq('/api/links', 'POST', { title: 'hola' }));
    expect(await noUrl.json()).toEqual({ error: 'invalid_url' });
  });
});

describe('Link r4: el referrer sobrevive a la puerta de contraseña', () => {
  it('la visita se registra con el referrer de antes de la puerta', async () => {
    const u = await makeUser('gref');
    const r = await createLink(u.id, { url: 'https://example.com/g', slug: slug('gr'), password: 'pw' });
    if (!r.ok) throw new Error('setup');
    const s = r.link.slug;
    const first = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${s}`, {
        headers: { host: 'localhost:3000', 'user-agent': DESKTOP, referer: 'https://t.co/abc' },
      }),
      { params: Promise.resolve({ slug: s }) },
    );
    expect(first.headers.get('location')).toContain(`/gate/${s}`);
    const saved = first.cookies.get(gateRefCookieName(s))?.value;
    expect(saved).toBe('t.co');

    const link = (await getUserLink(u.id, r.link.id))!;
    const back = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${s}`, {
        headers: {
          host: 'localhost:3000',
          'user-agent': DESKTOP,
          referer: `http://localhost:3000/en/gate/${s}`,
          cookie: `${gateCookieName(s)}=${gateToken(s, link.password_hash!)}; ${gateRefCookieName(s)}=${saved}`,
        },
      }),
      { params: Promise.resolve({ slug: s }) },
    );
    expect(back.headers.get('location')).toBe('https://example.com/g');
    const row = (await getDb().prepare('SELECT referrer FROM clicks WHERE link_id = ?').get(r.link.id)) as {
      referrer: string;
    };
    expect(row.referrer).toBe('t.co');
  });
});

describe('Link r4: textos y CSV', () => {
  const m: BreakdownMessages = {
    direct: 'directo',
    other: 'otros',
    unknown: 'Desconocido',
    variantDefault: 'Destino principal',
    device: { desktop: 'Escritorio', mobile: 'Móvil', tablet: 'Tablet' },
    rule: (n) => `Regla ${n}`,
    ab: (v) => `Variante ${v}`,
    app: (os) => `App ${os}`,
  };

  it("el navegador/sistema 'Other' de ua-parser se traduce", () => {
    const l = breakdownLabelers('es', m);
    expect(l.plain('Other')).toBe('otros');
    expect(l.plain('direct')).toBe('directo');
  });

  it('la tarjeta de preview usa el idioma del visitante', async () => {
    const u = await makeUser('prev');
    const r = await createLink(u.id, { url: 'https://example.com/p', slug: slug('pv'), ogTitle: 'Hola' });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    expect(linkPreviewHtml({ ...link, domain_hostname: null }, r.link.slug, 'es')).toContain('Continuar →');
    expect(linkPreviewHtml({ ...link, domain_hostname: null }, r.link.slug, 'en')).toContain('Continue →');
  });

  it('el CSV de resultados del alta masiva neutraliza fórmulas', () => {
    const csv = bulkResultsToCsv([
      { url: '=HYPERLINK("https://evil","ver")', short_url: 'https://zerosoft.ai/x', status: 'error', error: 'invalid_url' } as never,
    ]);
    expect(csv.split('\n')[1].startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('el export de links neutraliza fórmulas en título', async () => {
    const u = await asUser('expf', 'owner');
    const r = await createLink(u.id, { url: 'https://example.com/f', slug: slug('ef'), title: '=1+2' });
    if (!r.ok) throw new Error('setup');
    const res = await exportRoute.GET(new NextRequest('http://localhost:3000/api/links/export'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(",'=1+2,");
    expect(text).not.toContain(',=1+2,');
  });
});
