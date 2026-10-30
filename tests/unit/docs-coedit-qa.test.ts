import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocPage, createDocShare, getDocPageRow, parseBlocks, updateDocPage } from '@/lib/docs';
import { applyTextOps } from '@/lib/docs-coedit';
import { getRevision } from '@/lib/docs-revisions';
import { diff, textHash } from '@/lib/docs-ot';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

/**
 * QA de la edición simultánea: la versión de cualquier momento se arma con
 * las operaciones (guardados viejos se fusionan) y quien sugiere mientras
 * otra persona escribe en vivo no pierde sus sugerencias.
 */

type FakeUser = { id: string; email: string; name?: string | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.id,
  isWorkspaceAdmin: () => true,
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/lib/routes/docs/pages/[id]/route');

function req(url: string, method = 'GET', body?: unknown) {
  const r = new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return Object.assign(r, { cookies: { get: () => undefined }, nextUrl: new URL(url) }) as never;
}
const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });
const textOf = async (pageId: string, id = 'p') => parseBlocks((await getDocPageRow(pageId))!.content).find((b) => b.id === id)?.content;

async function typeOps(pageId: string, actorId: string, from: string, words: string[], session = 'sessionAAA') {
  let text = from;
  let rev = 0;
  const stamps: string[] = [];
  for (const [i, w] of words.entries()) {
    const next = text + w;
    // Sin versión: el servidor la ubica por la huella (sirve también sobre un bloque que ya tenía historia).
    const r = await applyTextOps({ pageId, actorId, session, items: [{ block: 'p', rev: i === 0 ? null : rev, hash: textHash(text), op: diff(text, next), seq: `${session}-${i}` }] });
    expect(r[0].status).toBe('ok');
    rev = r[0].events!.at(-1)!.rev;
    text = next;
    stamps.push((await getDocPageRow(pageId))!.updated_at);
  }
  return { text, stamps };
}

beforeEach(() => {
  session.user = null;
});

describe('versiones con la edición simultánea', () => {
  it('la versión de una tanda de teclas se arma exacta y un guardado sobre una base de hace 40 tandas se fusiona', async () => {
    const owner = await makeUser('rv1');
    const page = await createDocPage(owner.id, { title: 'Rev' });
    await updateDocPage(owner.id, page.id, { content: [para('p', 'a')] });
    const base = (await getDocPageRow(page.id))!.updated_at;
    const { text, stamps } = await typeOps(page.id, owner.id, 'a', Array.from({ length: 40 }, (_, i) => String(i % 10)));
    // Cualquier marca intermedia: la página como estaba ahí.
    const mid = await getRevision(page.id, stamps[19]);
    expect(mid).not.toBeNull();
    expect(parseBlocks(mid!.content)[0].content).toBe(`a${Array.from({ length: 20 }, (_, i) => String(i % 10)).join('')}`);
    // Un guardado de estructura sobre la base vieja (cliente viejo o la API, sin operaciones) no da 409 y no pisa lo escrito.
    await updateDocPage(owner.id, page.id, { content: [para('p', 'a'), para('q', 'nuevo')], base_updated_at: base });
    expect(await textOf(page.id)).toBe(text);
    expect(await textOf(page.id, 'q')).toBe('nuevo');
  });
});

describe('sugerencias mientras otra persona escribe en vivo', () => {
  it('quien comenta guarda su sugerencia aunque su pantalla ya tenga texto ajeno más nuevo que su base', async () => {
    const owner = await makeUser('sg1');
    const carla = await makeUser('sg1c');
    const page = await createDocPage(owner.id, { title: 'Sug' });
    await updateDocPage(owner.id, page.id, { content: [para('p', 'Reunión a las 10')] });
    await createDocShare(owner.id, page.id, 'user', carla.id, 'comment');
    const base = (await getDocPageRow(page.id))!.updated_at;
    // La dueña escribe en vivo; a Carla le llegan las teclas por el feed.
    const { text } = await typeOps(page.id, owner.id, 'Reunión a las 10', [' en', ' la', ' sala']);
    const sug = `<span data-sug="s1" data-sug-kind="ins" data-sug-by="${carla.id}"> (Zoom)</span>`;
    session.user = { id: carla.id, email: carla.email, name: carla.name };
    const res = await pageRoute.PATCH(req(`http://x/api/docs/pages/${page.id}`, 'PATCH', { content: [para('p', `${text}${sug}`)], base_updated_at: base }), { params: Promise.resolve({ id: page.id }) });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = await textOf(page.id);
    expect(saved).toContain('data-sug="s1"');
    expect(saved).toContain(' en la sala');
    // Su pantalla iba por la mitad (le faltaba la última tanda ajena): también entra al primer intento.
    const { text: text2 } = await typeOps(page.id, owner.id, saved!, [' hoy', ' mismo'], 'sessionBBB');
    const halfway = text2.slice(0, text2.length - ' mismo'.length);
    const sug2 = `<span data-sug="s2" data-sug-kind="ins" data-sug-by="${carla.id}"> (sí)</span>`;
    const res2 = await pageRoute.PATCH(req(`http://x/api/docs/pages/${page.id}`, 'PATCH', { content: [para('p', `${halfway}${sug2}`)], base_updated_at: base }), { params: Promise.resolve({ id: page.id }) });
    expect(res2.status, await res2.clone().text()).toBe(200);
    const saved2 = await textOf(page.id);
    expect(saved2).toContain('data-sug="s2"');
    expect(saved2).toContain(' hoy mismo');
    // Cambiar texto ajeno sigue sin estar permitido.
    const bad = await pageRoute.PATCH(req(`http://x/api/docs/pages/${page.id}`, 'PATCH', { content: [para('p', 'otra cosa')], base_updated_at: base }), { params: Promise.resolve({ id: page.id }) });
    expect(bad.status).toBe(403);
  });
});
