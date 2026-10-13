import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBitlyLinks, importLinks, itemsFromCsv, parseCsv } from '@/lib/bitly-import';
import { createLink, getLinkBySlug } from '@/lib/links';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

describe('import desde Bitly', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parsea CSV con comillas, comas y saltos de línea', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi""\nbye"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nbye'],
    ]);
  });

  it('detecta las columnas del export de Bitly', () => {
    const items = itemsFromCsv('Title,Bitlink,Long URL,Tags\nPromo,https://bit.ly/promo1,https://example.com/p,"a|b"\n');
    expect(items).toEqual([{ title: 'Promo', shortUrl: 'https://bit.ly/promo1', url: 'https://example.com/p', tags: ['a', 'b'] }]);
  });

  it('conserva back-halves, renombra los tomados y usa el dominio propio verificado', async () => {
    const u = await makeUser('bitly');
    const other = await makeUser('other');
    const taken = `taken${Date.now() % 100000}`;
    await createLink(other.id, { url: 'https://x.com', slug: taken });
    const domainId = crypto.randomUUID();
    await getDb()
      .prepare('INSERT INTO link_domains (id, user_id, hostname, verified) VALUES (?, ?, ?, 1)')
      .run(domainId, u.id, `go-${u.id.slice(-6)}.acme.test`);

    const report = await importLinks(u.id, [
      { shortUrl: `bit.ly/keep${u.id.slice(-5)}`, url: 'https://example.com/1' },
      { shortUrl: `https://bit.ly/${taken}`, url: 'https://example.com/2' },
      { shortUrl: `https://go-${u.id.slice(-6)}.acme.test/blog`, url: 'https://example.com/3' },
      { shortUrl: 'bit.ly/bad', url: 'javascript:alert(1)' },
    ]);
    expect(report.imported).toBe(3);
    expect(report.kept).toBe(2);
    expect(report.renamed).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect((await getLinkBySlug('blog', domainId))?.url).toBe('https://example.com/3');
  });

  it('pagina la API v4', async () => {
    const pages: Record<string, unknown> = {
      '/user': { default_group_guid: 'G1' },
      '/groups/G1/bitlinks?size=100&archived=both': {
        links: [{ id: 'bit.ly/a', link: 'https://bit.ly/a', long_url: 'https://e.com/a', custom_bitlinks: ['https://go.acme.com/a'] }],
        pagination: { next: 'https://api-ssl.bitly.com/v4/groups/G1/bitlinks?page=2' },
      },
      'https://api-ssl.bitly.com/v4/groups/G1/bitlinks?page=2': {
        links: [{ id: 'bit.ly/b', link: 'https://bit.ly/b', long_url: 'https://e.com/b' }],
        pagination: { next: '' },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const key = String(url).replace('https://api-ssl.bitly.com/v4', '');
      const body = pages[key] ?? pages[String(url)];
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    }));
    const items = await fetchBitlyLinks('tok');
    expect(items.map((i) => i.shortUrl)).toEqual(['https://go.acme.com/a', 'https://bit.ly/b']);
  });
});
