import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { applyLinkPatch, createLink, getUserLink, linkPatchSchema, toLinkDto } from '@/lib/links';
import { makeUser } from './helpers';

// after() necesita el contexto de request de Next: en tests no corre.
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const redirectRoute = await import('@/app/r/[slug]/route');

const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const slug = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;

function visit(s: string, ua = DESKTOP) {
  return redirectRoute.GET(
    new NextRequest(`http://localhost:3000/r/${s}`, { headers: { host: 'localhost:3000', 'user-agent': ua } }),
    { params: Promise.resolve({ slug: s }) },
  );
}

describe('Link: indexación del link corto', () => {
  it('el redirect lleva X-Robots-Tag: noindex por defecto', async () => {
    const u = await makeUser('idx');
    const r = await createLink(u.id, { url: 'https://example.com/a', slug: slug('ix') });
    if (!r.ok) throw new Error('setup');
    expect(toLinkDto(r.link).do_index).toBe(false);
    const res = await visit(r.link.slug);
    expect(res.status).toBe(302);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('también lo llevan los bots que siguen el redirect', async () => {
    const u = await makeUser('idx2');
    const r = await createLink(u.id, { url: 'https://example.com/b', slug: slug('ib') });
    if (!r.ok) throw new Error('setup');
    const res = await visit(r.link.slug, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('doIndex lo deja indexable y se cambia por PATCH', async () => {
    const u = await makeUser('idx3');
    const r = await createLink(u.id, { url: 'https://example.com/c', slug: slug('ic'), doIndex: true });
    if (!r.ok) throw new Error('setup');
    expect(toLinkDto(r.link).do_index).toBe(true);
    expect((await visit(r.link.slug)).headers.get('x-robots-tag')).toBeNull();

    const link = (await getUserLink(u.id, r.link.id))!;
    expect(await applyLinkPatch(link, linkPatchSchema.parse({ doIndex: false }))).toBeNull();
    expect((await getUserLink(u.id, r.link.id))!.do_index).toBe(0);
    expect((await visit(r.link.slug)).headers.get('x-robots-tag')).toBe('noindex');
  });
});
