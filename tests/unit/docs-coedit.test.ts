import { describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createDocPage, createDocShare, deleteDocShare, getDocPageRow, parseBlocks, updateDocPage } from '@/lib/docs';
import { applyTextOps, blockSnapshots, coeditFilter, coeditFeed, currentAccess, publicEvent, type CoeditViewer } from '@/lib/docs-coedit';
import { COEDIT_BLOCK_MAX, isCoeditBlock } from '@/lib/docs-coedit-shared';
import { DOCS_BLOCK_MAX } from '@/lib/docs-schema';
import { diff, textHash } from '@/lib/docs-ot';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });

async function pageWith(ownerId: string, blocks: DocsBlock[]) {
  const page = await createDocPage(ownerId, { title: 'Co' });
  await updateDocPage(ownerId, page.id, { content: blocks });
  return page.id;
}

const textOf = async (pageId: string, id = 'p') => parseBlocks((await getDocPageRow(pageId))!.content).find((b) => b.id === id)?.content;

async function events(pageId: string) {
  return (await getDb().prepare("SELECT kind, block_id, rev, session_id, seq FROM docs_live_events WHERE page_id = ? AND kind = 'op' ORDER BY id").all(pageId)) as Array<{
    kind: string;
    block_id: string;
    rev: number;
    session_id: string | null;
    seq: string | null;
  }>;
}

describe('docs-coedit (servidor)', () => {
  it('dos sesiones sobre la misma versión del mismo bloque: se transforman y quedan las dos', async () => {
    const owner = await makeUser('co1');
    const pageId = await pageWith(owner.id, [para('p', 'centro')]);
    const base = { rev: 0, hash: textHash('centro') };
    const a = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [{ block: 'p', ...base, op: diff('centro', 'centro A'), seq: 'a1' }] });
    expect(a[0].status).toBe('ok');
    const b = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionBBB', items: [{ block: 'p', ...base, op: diff('centro', 'Bcentro'), seq: 'b1' }] });
    expect(b[0].status).toBe('ok');
    expect(await textOf(pageId)).toBe('Bcentro A');
    expect((await events(pageId)).map((e) => e.rev)).toEqual([1, 2]);
    // La respuesta trae la propia ya transformada (lo que el navegador confirma).
    expect(b[0].events?.[0]).toMatchObject({ rev: 2, seq: 'b1', hb: textHash('centro A'), ha: textHash('Bcentro A') });
  });

  it('reintentar la misma seq no la aplica dos veces', async () => {
    const owner = await makeUser('co2');
    const pageId = await pageWith(owner.id, [para('p', 'x')]);
    const item = { block: 'p', rev: 0, hash: textHash('x'), op: diff('x', 'xy'), seq: 's1' };
    await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [item] });
    const again = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [item] });
    expect(again[0].status).toBe('dup');
    expect(await textOf(pageId)).toBe('xy');
  });

  it('versión desconocida: se ubica por la huella; sin base conocida pide resync o fusiona con el texto base', async () => {
    const owner = await makeUser('co3');
    const pageId = await pageWith(owner.id, [para('p', 'uno')]);
    await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [{ block: 'p', rev: 0, hash: textHash('uno'), op: diff('uno', 'uno dos'), seq: 'a1' }] });
    // Por huella (rev null) contra la versión 0.
    const r = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionBBB', items: [{ block: 'p', rev: null, hash: textHash('uno'), op: diff('uno', 'cero uno'), seq: 'b1' }] });
    expect(r[0].status).toBe('ok');
    expect(await textOf(pageId)).toBe('cero uno dos');
    // Una huella que nadie tuvo: resync con el texto actual.
    const bad = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionCCC', items: [{ block: 'p', rev: null, hash: textHash('otra'), op: diff('otra', 'otra!'), seq: 'c1' }] });
    expect(bad[0]).toMatchObject({ status: 'resync', text: 'cero uno dos', rev: 2 });
    // Con el texto base (al reconectar después de mucho): se fusiona.
    const merged = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionCCC', items: [{ block: 'p', rev: null, hash: textHash('uno'), op: diff('uno', 'uno tres'), seq: 'c2', base: 'uno' }] });
    expect(merged[0].status).toBe('ok');
    // Las dos inserciones en el mismo punto quedan (el orden lo decide la transformación).
    expect(await textOf(pageId)).toMatch(/^cero uno( dos tres| tres dos)$/);
  });

  it('un guardado que cambia el texto por otro camino queda como operación; con text_ops el guardado no pisa el texto', async () => {
    const owner = await makeUser('co4');
    const pageId = await pageWith(owner.id, [para('p', 'hola')]);
    await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [{ block: 'p', rev: 0, hash: textHash('hola'), op: diff('hola', 'hola mundo'), seq: 'a1' }] });
    // Un guardado del editor con operaciones activas y texto viejo: el texto queda; el bloque nuevo entra.
    const row = (await getDocPageRow(pageId))!;
    await updateDocPage(owner.id, pageId, { content: [para('p', 'hola'), para('q', 'nuevo')], base_updated_at: row.updated_at, text_ops: true });
    expect(await textOf(pageId)).toBe('hola mundo');
    expect(await textOf(pageId, 'q')).toBe('nuevo');
    // Un guardado sin operaciones (API, restaurar): se registra como operación de reconciliación.
    await updateDocPage(owner.id, pageId, { content: [para('p', 'chau mundo'), para('q', 'nuevo')] });
    const ev = await events(pageId);
    expect(ev.at(-1)).toMatchObject({ block_id: 'p', rev: 2, session_id: null });
    const st = (await getDb().prepare('SELECT rev, text FROM docs_block_text WHERE page_id = ? AND block_id = ?').get(pageId, 'p')) as { rev: number; text: string };
    expect(st).toEqual({ rev: 2, text: 'chau mundo' });
  });

  it('XSS: lo que manda el navegador se sanea antes de guardar; el feed y la respuesta llevan una sola operación limpia', async () => {
    const owner = await makeUser('co5');
    const pageId = await pageWith(owner.id, [para('p', 'ab')]);
    const payloads = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>', '<b onclick="alert(1)">y</b>'];
    let text = 'ab';
    for (const [k, payload] of payloads.entries()) {
      const r = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [{ block: 'p', rev: k, hash: textHash(text), op: [1, payload, text.length - 1], seq: `a${k}` }] });
      expect(r[0].status).toBe('ok');
      expect(r[0].events?.length).toBe(1);
      expect(JSON.stringify(r[0].events)).not.toMatch(/onerror|onclick|<script|javascript:|<img/i);
      text = (await textOf(pageId))!;
      expect(text).not.toMatch(/onerror|onclick|<script|javascript:|<img/i);
    }
    // Nada de eso quedó en el feed (ni como operación del navegador ni en ningún otro evento).
    const rows = (await getDb().prepare('SELECT kind, payload FROM docs_live_events WHERE page_id = ?').all(pageId)) as Array<{ kind: string; payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.payload).not.toMatch(/onerror|onclick|<script|javascript:|<img/i);
    // Lo que sale por el stream: la versión pública de esos eventos tampoco.
    const raw = (await getDb().prepare("SELECT * FROM docs_live_events WHERE page_id = ? AND kind = 'op'").all(pageId)) as Array<Record<string, unknown>>;
    const viewer: CoeditViewer = { ownerId: owner.id, realId: owner.id, actor: { id: owner.id } };
    const out = await coeditFilter(viewer, pageId, 'owner', () => undefined)(
      raw.map((r) => ({ id: Number(r.id), workspaceId: String(r.workspace_id), pageId, userId: (r.user_id as string) ?? null, kind: 'op', blockId: 'p', rev: Number(r.rev), session: (r.session_id as string) ?? null, seq: (r.seq as string) ?? null, payload: JSON.parse(String(r.payload)) })),
    );
    expect(out.length).toBe(payloads.length);
    expect(JSON.stringify(out)).not.toMatch(/onerror|onclick|<script|javascript:|<img/i);
    // Y si una fila vieja lo tuviera, no sale por el stream.
    expect(publicEvent({ id: 1, workspaceId: owner.id, pageId, userId: null, kind: 'op', blockId: 'p', rev: 9, session: null, seq: null, payload: { op: [1, '<img src=x onerror=alert(1)>'], hb: '', ha: '' } })).toBeNull();
  });

  it('links a páginas: un bloque con link no viaja por operaciones (el título no sale por el feed ni por la foto)', async () => {
    const owner = await makeUser('co5l');
    const secret = await createDocPage(owner.id, { title: 'Plan secreto' });
    const link = `<a href="/app/docs/${secret.id}" data-page="${secret.id}">Plan secreto</a>`;
    const pageId = await pageWith(owner.id, [para('p', `ver ${link}`), para('q', 'texto')]);
    const row = (await getDocPageRow(pageId))!;
    expect((await blockSnapshots(row, ['p', 'q'])).p).toBeNull();
    // Operaciones sobre ese bloque, o que meten un link en otro: no se aplican.
    const r = await applyTextOps({
      pageId,
      actorId: owner.id,
      session: 'sessionAAA',
      items: [
        { block: 'p', rev: 0, hash: textHash(`ver ${link}`), op: ['x', `ver ${link}`.length], seq: 'l1' },
        { block: 'q', rev: 0, hash: textHash('texto'), op: [5, ` ${link}`], seq: 'l2' },
      ],
    });
    expect(r.map((x) => x.status)).toEqual(['unsupported', 'unsupported']);
    expect(await textOf(pageId, 'q')).toBe('texto');
    const rows = (await getDb().prepare('SELECT payload FROM docs_live_events WHERE page_id = ?').all(pageId)) as Array<{ payload: string }>;
    for (const x of rows) expect(x.payload).not.toContain('Plan secreto');
    // Un guardado que cambia ese bloque tampoco lo publica como operación.
    await updateDocPage(owner.id, pageId, { content: [para('p', `ver otra vez ${link}`), para('q', 'texto')] });
    const after = (await getDb().prepare('SELECT payload FROM docs_live_events WHERE page_id = ?').all(pageId)) as Array<{ payload: string }>;
    for (const x of after) expect(x.payload).not.toContain('Plan secreto');
  });

  it(`tope: un bloque no pasa de ${DOCS_BLOCK_MAX} caracteres por operaciones (el guardado sigue andando)`, async () => {
    const owner = await makeUser('co5b');
    const pageId = await pageWith(owner.id, [para('p', 'a'), para('q', 'b')]);
    const r = await applyTextOps({ pageId, actorId: owner.id, session: 'sessionAAA', items: [{ block: 'p', rev: 0, hash: textHash('a'), op: [1, 'x'.repeat(DOCS_BLOCK_MAX + 10)], seq: 'b1' }] });
    expect(r[0].status).toBe('too_large');
    expect(await textOf(pageId)).toBe('a');
    expect(COEDIT_BLOCK_MAX).toBe(DOCS_BLOCK_MAX);
    // Un guardado de estructura después sigue funcionando.
    await updateDocPage(owner.id, pageId, { content: [para('p', 'a'), para('q', 'b'), para('n', 'nuevo')], text_ops: true });
    expect(await textOf(pageId, 'n')).toBe('nuevo');
  });

  it('bloques que no son de texto o que no existen', async () => {
    const owner = await makeUser('co6');
    const pageId = await pageWith(owner.id, [para('p', 'a'), { id: 'd', type: 'divider', content: '' }, { id: 'g', type: 'design', content: '' }]);
    const r = await applyTextOps({
      pageId,
      actorId: owner.id,
      session: 'sessionAAA',
      items: [
        { block: 'd', rev: 0, hash: textHash(''), op: ['x'], seq: 'a1' },
        { block: 'zz', rev: 0, hash: textHash(''), op: ['x'], seq: 'a2' },
        // El bloque de Design (/design) se guarda entero, no por operaciones.
        { block: 'g', rev: 0, hash: textHash(''), op: ['x'], seq: 'a3' },
      ],
    });
    expect(r.map((x) => x.status)).toEqual(['unsupported', 'gone', 'unsupported']);
    expect(isCoeditBlock({ type: 'design', content: '' })).toBe(false);
    expect((await blockSnapshots((await getDocPageRow(pageId))!, ['g'])).g).toBeNull();
  });

  it('acceso: al borrar el share el stream corta; sacar la app Docs también', async () => {
    const owner = await makeUser('co7');
    const guest = await makeUser('co7g');
    const pageId = await pageWith(owner.id, [para('p', 'a')]);
    const share = await createDocShare(owner.id, pageId, 'user', guest.id, 'view');
    const viewer: CoeditViewer = { ownerId: guest.id, realId: guest.id, actor: { id: guest.id }, pageWorkspace: owner.id };
    expect(await currentAccess(viewer, pageId)).toBe('view');
    let revoked = false;
    const filter = coeditFilter(viewer, pageId, 'view', () => (revoked = true));
    const feed = coeditFeed();
    void feed;
    await deleteDocShare(owner.id, pageId, share!.id);
    const raw = (await getDb().prepare("SELECT * FROM docs_live_events WHERE kind = 'access' ORDER BY id DESC LIMIT 1").get()) as Record<string, unknown>;
    expect(raw).toBeTruthy();
    await filter([{ id: Number(raw.id), workspaceId: String(raw.workspace_id), pageId: null, userId: null, kind: 'access', blockId: null, rev: null, session: null, seq: null, payload: {} }]);
    expect(revoked).toBe(true);
    expect(await currentAccess(viewer, pageId)).toBeNull();

    // Miembro del workspace al que le sacan Docs de sus apps.
    const member = await makeUser('co7m');
    const team = await createTeam(owner.id, 'Equipo');
    await addMember(team.id, member.id, 'member');
    const asMember: CoeditViewer = { ownerId: owner.id, realId: member.id, actor: { id: owner.id, actingUser: member as never, role: 'member' } };
    expect(await currentAccess(asMember, pageId)).not.toBeNull();
    await getDb().prepare('UPDATE team_members SET apps = ? WHERE team_id = ? AND user_id = ?').run(JSON.stringify(['crm']), team.id, member.id);
    expect(await currentAccess(asMember, pageId)).toBeNull();
  });
});
