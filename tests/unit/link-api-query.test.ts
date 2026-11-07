import { describe, expect, it } from 'vitest';
import { createLink, listLinks } from '@/lib/links';
import { parseLinkListQuery } from '@/lib/link-api-query';
import { makeUser } from './helpers';

const qs = (s: string) => parseLinkListQuery(new URLSearchParams(s));
const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

describe('parseLinkListQuery', () => {
  it('sin parámetros trae todos, por fecha, página 1', () => {
    expect(qs('')).toMatchObject({ archived: 'all', sort: 'created', page: 1, pageSize: 10, q: undefined, tag: undefined });
  });

  it('entiende archived true/false y sort clicks; ignora lo desconocido', () => {
    expect(qs('archived=true').archived).toBe('1');
    expect(qs('archived=false').archived).toBe('0');
    expect(qs('archived=maybe').archived).toBe('all');
    expect(qs('sort=clicks').sort).toBe('clicks');
    expect(qs('sort=nope').sort).toBe('created');
    expect(qs('page=abc&pageSize=x')).toMatchObject({ page: 1, pageSize: 10 });
  });

  it('recorta y descarta textos vacíos', () => {
    expect(qs('q=%20%20').q).toBeUndefined();
    expect(qs(`q=${'a'.repeat(300)}`).q).toHaveLength(100);
    expect(qs('tag=launch&folder=none').tag).toBe('launch');
    expect(qs('folder=none').folder).toBe('none');
  });
});

describe('listLinks con los filtros de la API', () => {
  it('filtra por búsqueda, tag y archivado dentro del workspace', async () => {
    const u = await makeUser('apifilter');
    const other = await makeUser('apifilterother');
    const a = await createLink(u.id, { url: 'https://example.com/pricing', slug: slug('pr'), tags: ['launch'] });
    const b = await createLink(u.id, { url: 'https://example.com/blog', slug: slug('bl'), tags: ['docs'] });
    await createLink(other.id, { url: 'https://example.com/pricing', slug: slug('ot'), tags: ['launch'] });
    if (!a.ok || !b.ok) throw new Error('setup');

    const byQ = await listLinks(u.id, qs('q=pricing'));
    expect(byQ.links.map((l) => l.id)).toEqual([a.link.id]);
    const byTag = await listLinks(u.id, qs('tag=docs'));
    expect(byTag.links.map((l) => l.id)).toEqual([b.link.id]);
    expect((await listLinks(u.id, qs(''))).total).toBe(2);
    expect((await listLinks(u.id, qs('archived=true'))).total).toBe(0);
    expect((await listLinks(u.id, qs('archived=false'))).total).toBe(2);
    expect((await listLinks(u.id, qs('folder=none'))).total).toBe(2);
  });
});
