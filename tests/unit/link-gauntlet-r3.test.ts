import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createLink, toLinkDto, userTags } from '@/lib/links';
import { bulkResultsToCsv } from '@/lib/link-bulk-csv';
import { importLinks } from '@/lib/bitly-import';
import { bioEditorLinks, saveBioSettings } from '@/lib/link-bio';
import { contextFromHeaders, exportClicks, recordClick } from '@/lib/track';
import { EVENT_SAMPLES } from '@/lib/flow-schema';
import { breakdownLabelers, type BreakdownMessages } from '@/lib/link-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string }) => u.id,
}));

const bulkRoute = await import('@/app/api/links/bulk/route');

const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function linkCount(userId: string): Promise<number> {
  return ((await getDb().prepare('SELECT COUNT(*) AS c FROM links WHERE user_id = ?').get(userId)) as { c: number }).c;
}

describe('Link r3: el alta masiva no recrea links para descargar el CSV', () => {
  it('el POST ignora `download`: siempre JSON y crea una sola vez', async () => {
    const u = await makeUser('bulkdl');
    session.user = u as unknown as Record<string, unknown>;
    const req = new NextRequest('http://x/api/links/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.3.${Date.now() % 250}.1` },
      body: JSON.stringify({ urls: 'https://example.com/a\nhttps://example.com/b', download: true }),
    });
    const res = await bulkRoute.POST(req as never);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = (await res.json()) as { results: Array<{ short_url: string; status: string; url: string }> };
    expect(await linkCount(u.id)).toBe(2);

    // El CSV se arma con los resultados ya creados (los mismos slugs que en pantalla).
    const csv = bulkResultsToCsv(data.results as never);
    expect(csv.split('\n')).toEqual([
      'original_url,short_url,status,title',
      `https://example.com/a,${data.results[0].short_url},created,`,
      `https://example.com/b,${data.results[1].short_url},created,`,
    ]);
    session.user = null;
  });
});

describe('Link r3: reimportar desde Bitly no duplica', () => {
  it('la segunda corrida saltea los back-halves que ya son del workspace con el mismo destino', async () => {
    const u = await makeUser('reimp');
    const keep = `ri${u.id.slice(-6)}`;
    const items = [
      { shortUrl: `https://bit.ly/${keep}`, url: 'example.com/uno' },
      { shortUrl: `https://bit.ly/${keep}x`, url: 'https://example.com/dos' },
    ];
    const first = await importLinks(u.id, items);
    expect(first.imported).toBe(2);
    expect(first.kept).toBe(2);

    const second = await importLinks(u.id, items);
    expect(second.imported).toBe(0);
    expect(second.renamed).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toEqual(['already_imported', 'already_imported']);
    expect(await linkCount(u.id)).toBe(2);
  });

  it('si el back-half propio apunta a otro destino, se importa con otro slug', async () => {
    const u = await makeUser('reimp2');
    const s = `rj${u.id.slice(-6)}`;
    await createLink(u.id, { url: 'https://example.com/viejo', slug: s });
    const report = await importLinks(u.id, [{ shortUrl: `bit.ly/${s}`, url: 'https://example.com/nuevo' }]);
    expect(report.imported).toBe(1);
    expect(report.renamed).toHaveLength(1);
  });
});

describe('Link r3: editor de la página bio', () => {
  it('incluye todos los links elegidos (viejos o archivados), no solo los 50 más nuevos', async () => {
    const u = await makeUser('bioed');
    const old = await createLink(u.id, { url: 'https://example.com/viejo', slug: slug('bo') });
    const archived = await createLink(u.id, { url: 'https://example.com/arch', slug: slug('ba') });
    if (!old.ok || !archived.ok) throw new Error('setup');
    await getDb().prepare("UPDATE links SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(old.link.id);
    for (let i = 0; i < 52; i++) await createLink(u.id, { url: `https://example.com/n${i}`, slug: slug('bn') });
    await saveBioSettings(u.id, { title: '', bio: '', avatarUrl: null, published: true, linkIds: [archived.link.id, old.link.id] });
    await getDb().prepare('UPDATE links SET archived = 1 WHERE id = ?').run(archived.link.id);

    const links = await bioEditorLinks(u.id);
    expect(links.slice(0, 2).map((l) => l.id)).toEqual([archived.link.id, old.link.id]);
    expect(links[0].archived).toBe(true);
    expect(links).toHaveLength(52);
  });
});

describe('Link r3: export CSV por link con tope', () => {
  it('exportClicks respeta el límite y trae los más recientes', async () => {
    const u = await makeUser('explim');
    const r = await createLink(u.id, { url: 'https://example.com/e', slug: slug('ex') });
    if (!r.ok) throw new Error('setup');
    const ctx = contextFromHeaders(new Headers({ 'user-agent': DESKTOP }));
    for (let i = 0; i < 3; i++) await recordClick(r.link.id, ctx);
    expect(await exportClicks(r.link.id, r.link.created_at, { range: 'all' }, 2)).toHaveLength(2);
    expect(await exportClicks(r.link.id, r.link.created_at, { range: 'all' })).toHaveLength(3);
  });
});

describe('Link r3: el conteo que va a Flow es el real', () => {
  it('recordClick devuelve el total con este click: concurrentes ven números distintos', async () => {
    const u = await makeUser('cnt');
    const r = await createLink(u.id, { url: 'https://example.com/c', slug: slug('cn'), maxClicks: 5 });
    if (!r.ok) throw new Error('setup');
    const ctx = contextFromHeaders(new Headers({ 'user-agent': DESKTOP }));
    const results = await Promise.all(Array.from({ length: 7 }, () => recordClick(r.link.id, ctx)));
    const counts = results.filter((c): c is number => c !== null).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5]);
    expect(results.filter((c) => c === null)).toHaveLength(2);
  });
});

describe('Link r3: ejemplo de evento de Flow alineado con el payload real', () => {
  it('link.created usa las claves de LinkDto (short_url) y link.clicked trae short_url', async () => {
    const u = await makeUser('flowsample');
    const r = await createLink(u.id, { url: 'https://example.com/f', slug: slug('fs') });
    if (!r.ok) throw new Error('setup');
    const dto = toLinkDto(r.link);
    const sample = EVENT_SAMPLES['link.created'].link as Record<string, unknown>;
    for (const key of Object.keys(sample)) expect(dto).toHaveProperty(key);
    expect(sample).toHaveProperty('short_url');
    expect(sample).not.toHaveProperty('shortUrl');
    expect(EVENT_SAMPLES['link.clicked'].link).toHaveProperty('short_url');
  });
});

describe('Link r3: etiquetas traducidas en analytics', () => {
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
  const l = breakdownLabelers('es', m);

  it('traduce dispositivos, desconocidos y variantes', () => {
    expect(l.device('mobile')).toBe('Móvil');
    expect(l.device('desktop')).toBe('Escritorio');
    expect(l.device('unknown')).toBe('Desconocido');
    expect(l.plain('unknown')).toBe('Desconocido');
    expect(l.plain('Chrome')).toBe('Chrome');
    expect(l.variant('rule:2')).toBe('Regla 2');
    expect(l.variant('ab:B')).toBe('Variante B');
    expect(l.variant('app:android')).toBe('App Android');
    expect(l.variant('default')).toBe('Destino principal');
  });

  it('países con nombre localizado', () => {
    expect(l.country('AR')).toBe('Argentina');
    expect(l.country('other')).toBe('otros');
    expect(l.country('unknown')).toBe('Desconocido');
    expect(breakdownLabelers('en', m).country('DE')).toBe('Germany');
  });
});

describe('Link r3: tags del workspace sin leer todas las filas', () => {
  it('devuelve los tags distintos, ordenados, tolerando JSON roto o vacío', async () => {
    const u = await makeUser('tags');
    await createLink(u.id, { url: 'https://example.com/t1', slug: slug('tg'), tags: ['zeta', 'alfa'] });
    await createLink(u.id, { url: 'https://example.com/t2', slug: slug('tg'), tags: ['alfa', 'beta'] });
    const broken = await createLink(u.id, { url: 'https://example.com/t3', slug: slug('tg') });
    if (!broken.ok) throw new Error('setup');
    await getDb().prepare("UPDATE links SET tags = '{roto' WHERE id = ?").run(broken.link.id);
    const other = await makeUser('tags2');
    await createLink(other.id, { url: 'https://example.com/t4', slug: slug('tg'), tags: ['ajeno'] });
    expect(await userTags(u.id)).toEqual(['alfa', 'beta', 'zeta']);
  });
});
