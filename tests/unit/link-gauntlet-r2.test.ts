import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { applyLinkPatch, createLink, getUserLink, isShortLinkUrl, linkPatchSchema } from '@/lib/links';
import { dnsInstructions, registrableDomain } from '@/lib/link-domains';
import { getPublicBio, saveBioSettings } from '@/lib/link-bio';
import { clicksToCsv } from '@/lib/track';
import { workspaceClicksToCsv, type WorkspaceClickRow } from '@/lib/link-analytics';
import { makeUser } from './helpers';

// Las traducciones de la puerta: en tests no hay request de Next.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
// next-intl/middleware no resuelve next/server en vitest: un pasamanos alcanza
// (acá se prueba lo que el middleware decide antes de i18n).
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});
// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const { gateMetadata } = await import('@/lib/link-preview');
const redirectRoute = await import('@/app/r/[slug]/route');
const { default: middleware } = await import('@/middleware');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

describe('Link r2: la puerta no filtra el destino', () => {
  it('los metadatos de un link protegido no dependen del link (ni url, ni título, ni og_*)', async () => {
    const u = await makeUser('gate');
    const r = await createLink(u.id, {
      url: 'https://drive.example.com/contrato-privado',
      slug: slug('gt'),
      title: 'Contrato secreto',
      password: 'hunter22',
    });
    if (!r.ok) throw new Error('setup');
    const meta = await gateMetadata('es');
    const json = JSON.stringify(meta);
    expect(json).not.toContain('drive.example.com');
    expect(json).not.toContain('Contrato secreto');
    expect(meta).toMatchObject({ title: 'gate.title', robots: { index: false } });
  });
});

describe('Link r2: anti-loop en la segmentación', () => {
  it('reconoce la puerta /<locale>/gate/<slug> como link corto', async () => {
    expect(await isShortLinkUrl('http://localhost:3000/es/gate/abc123')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/en/gate/abc123/')).toBe(true);
    expect(await isShortLinkUrl('http://localhost:3000/es/blog')).toBe(false);
  });

  it('rechaza variantes A/B, reglas, fallbacks y universal links que vuelven a un link corto', async () => {
    const u = await makeUser('tgloop');
    const r = await createLink(u.id, { url: 'https://example.com/ok', slug: slug('tl') });
    if (!r.ok) throw new Error('setup');
    const link = (await getUserLink(u.id, r.link.id))!;
    const self = `http://localhost:3000/${r.link.slug}`;
    const cases = [
      { ab: [{ url: 'https://example.com/a', weight: 50 }, { url: self, weight: 50 }] },
      { rules: [{ countries: ['AR'], url: `http://localhost:3000/es/gate/${r.link.slug}` }] },
      { ios: { app: 'miapp://x', fallback: `http://localhost:3000/r/${r.link.slug}` } },
      { android: { app: self } },
    ];
    for (const targeting of cases) {
      expect(await applyLinkPatch(link, linkPatchSchema.parse({ targeting })), JSON.stringify(targeting)).toEqual({
        error: 'self_link',
        status: 400,
      });
    }
    // Destinos externos siguen andando.
    expect(
      await applyLinkPatch(
        link,
        linkPatchSchema.parse({
          targeting: { ab: [{ url: 'https://example.com/a', weight: 50 }, { url: 'https://example.com/b', weight: 50 }] },
        }),
      ),
    ).toBeNull();
  });
});

describe('Link r2: dominios propios solo sirven links', () => {
  const at = (path: string, host = 'go.empresa.com') =>
    middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));

  it('bio, booking, formularios y el sitio dan 404 bajo un dominio propio', async () => {
    for (const path of ['/es/bio/atacante', '/es/book/x', '/es/f/abc', '/es/h/abc', '/es/auth', '/es', '/es/blog/post']) {
      const res = await at(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('la raíz, los slugs, la puerta y /gone siguen funcionando', async () => {
    expect((await at('/')).headers.get('x-middleware-rewrite')).toContain('/r/__root');
    expect((await at('/promo')).headers.get('x-middleware-rewrite')).toContain('/r/promo');
    for (const path of ['/es/gate/promo', '/en/gone']) {
      expect((await at(path)).status, path).not.toBe(404);
    }
    // En el host de la app, nada cambia.
    expect((await at('/es/bio/alguien', 'localhost:3000')).status).not.toBe(404);
  });
});

describe('Link r2: el 301 no queda cacheado en el navegador', () => {
  it('el redirect sale con cache-control: no-store', async () => {
    const u = await makeUser('r301');
    const r = await createLink(u.id, { url: 'https://example.com/perm', slug: slug('pm'), redirectType: 301 });
    if (!r.ok) throw new Error('setup');
    const res = await redirectRoute.GET(
      new NextRequest(`http://localhost:3000/r/${r.link.slug}`, {
        headers: {
          host: 'localhost:3000',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        },
      }),
      { params: Promise.resolve({ slug: r.link.slug }) },
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('Link r2: instrucciones DNS', () => {
  it('apex con sufijo de dos niveles (.com.ar, .com.br, .co.uk)', () => {
    expect(registrableDomain('miempresa.com.ar')).toBe('miempresa.com.ar');
    expect(registrableDomain('go.miempresa.com.br')).toBe('miempresa.com.br');
    const [route, txt] = dnsInstructions('miempresa.com.ar', 'tok');
    expect(route.name).toBe('@');
    expect(route.type === 'A' || route.value !== '').toBe(true);
    expect(txt.name).toBe('_zerosoft-verify');
    const sub = dnsInstructions('go.miempresa.co.uk', 'tok');
    expect(sub[0]).toMatchObject({ type: 'CNAME', name: 'go' });
    expect(sub[1].name).toBe('_zerosoft-verify.go');
  });

  it('subdominios de más de un nivel usan el label completo', () => {
    const [route, txt] = dnsInstructions('links.go.empresa.com', 'tok');
    expect(route).toMatchObject({ type: 'CNAME', name: 'links.go' });
    expect(txt.name).toBe('_zerosoft-verify.links.go');
    const apex = dnsInstructions('empresa.com', 'tok');
    expect(apex[0].name).toBe('@');
    expect(apex[1].name).toBe('_zerosoft-verify');
  });
});

describe('Link r2: CSV sin fórmulas', () => {
  it('neutraliza = + - @ al inicio de una celda (Referer de un visitante)', () => {
    const click = {
      ts: '2026-01-01 00:00:00',
      country: 'AR',
      referrer: '=image(a1)',
      device: '+cmd',
      browser: '-1+1',
      os: '@sum',
      source: 'link',
      variant: null,
    } as unknown as Parameters<typeof clicksToCsv>[0][number];
    const csv = clicksToCsv([click]).split('\n')[1];
    expect(csv).toContain(`'=image(a1)`);
    expect(csv).toContain(`'+cmd`);
    expect(csv).toContain(`'-1+1`);
    expect(csv).toContain(`'@sum`);

    const row: WorkspaceClickRow = {
      ts: '2026-01-01 00:00:00',
      slug: 'abc',
      short_url: 'https://zerosoft.ai/abc',
      source: 'link',
      variant: null,
      country: null,
      referrer: '=webservice(a2)',
      device: null,
      browser: null,
      os: null,
    };
    expect(workspaceClicksToCsv([row])).toContain(`'=webservice(a2)`);
  });
});

describe('Link r2: altas concurrentes con el mismo slug', () => {
  it('la segunda devuelve slug_taken, no un 500', async () => {
    const u = await makeUser('race');
    const s = slug('rc');
    const results = await Promise.all([
      createLink(u.id, { url: 'https://example.com/1', slug: s }),
      createLink(u.id, { url: 'https://example.com/2', slug: s }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, code: 'slug_taken' });
  });
});

describe('Link r2: la bio no muestra links agotados', () => {
  it('un link que llegó a max_clicks sale de la página pública', async () => {
    const u = await makeUser('bio');
    const a = await createLink(u.id, { url: 'https://example.com/a', slug: slug('ba'), title: 'Vivo' });
    const b = await createLink(u.id, { url: 'https://example.com/b', slug: slug('bb'), title: 'Agotado', maxClicks: 1 });
    if (!a.ok || !b.ok) throw new Error('setup');
    await getDb().prepare('UPDATE links SET clicks = 1 WHERE id = ?').run(b.link.id);
    await saveBioSettings(u.id, { title: 'Mi bio', bio: '', avatarUrl: null, published: true, linkIds: [a.link.id, b.link.id] });
    const bio = await getPublicBio((u as { handle: string }).handle);
    expect(bio?.links.map((l) => l.title)).toEqual(['Vivo']);
  });
});
