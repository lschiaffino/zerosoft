import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  bulkNotes,
  createNote,
  createNotebook,
  deleteTag,
  getNote,
  getSharedNote,
  listNotebooks,
  listNotes,
  listNotesForSync,
  listTags,
  lockNote,
  renameStack,
  renameTag,
  setNotebookStack,
  setNoteShared,
  setNotesFtsOverride,
  unlockNote,
  updateNote,
  NotesError,
  type NoteOwner,
} from '@/lib/notes';
import {
  createNoteTemplate,
  createSavedSearch,
  deleteNoteTemplate,
  deleteSavedSearch,
  listNoteTemplates,
  listSavedSearches,
  renameNoteTemplate,
  searchSavedSearches,
  updateSavedSearch,
} from '@/lib/notes-library';
import { buildTagTree, normalizeTag, removeTagFrom, renameTagIn, type NoteDetail } from '@/lib/notes-types';
import { fileBlocksOnly, newNoteKey, openNote, openNoteWithKey, sealNote, WrongPasswordError } from '@/lib/notes-crypto';
import { blocksToEnml, inlineToEnml, noteToEnex, noteToHtml, ENEX_HEAD, ENEX_TAIL, enexResource } from '@/lib/notes-export';
import { enmlToBlocks, parseEnex } from '@/lib/notes-import';
import { applyHomography, enhanceDocument, homography, warpQuad } from '@/lib/notes-scan';
import { getNoteBuiltinTemplates } from '@/lib/notes-templates-builtin';
import {
  applyPatchLocally,
  identityMatches,
  makeOp,
  mergeIntoOutbox,
  offlineList,
  replayOutbox,
  retryDelay,
  stuckFrom,
  type CachedNote,
  type OutboxOp,
} from '@/components/notes/notesOffline';
import { groupNotebooks, highlightTerms, nextSelection } from '@/components/notes/notes-ui';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const lockRoute = await import('@/lib/routes/notes/[id]/lock/route');
const bulkRoute = await import('@/app/api/notes/bulk/route');
const syncRoute = await import('@/app/api/notes/sync/route');
const noteRoute = await import('@/lib/routes/notes/[id]/route');
const tplRoute = await import('@/app/api/notes/templates/route');
const tplIdRoute = await import('@/lib/routes/notes/templates/[id]/route');
const exportRoute = await import('@/lib/routes/notes/[id]/export/route');

const para = (text: string): DocsBlock => ({ id: crypto.randomUUID(), type: 'paragraph', content: text });
const todo = (text: string, checked = false): DocsBlock => ({ id: crypto.randomUUID(), type: 'todo', content: text, checked });

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function owner(label = 'npar'): Promise<{ user: Awaited<ReturnType<typeof makeUser>>; o: NoteOwner }> {
  const user = await makeUser(label);
  return { user, o: { workspaceId: user.id, personId: user.id } };
}

beforeEach(() => {
  session.user = null;
  setNotesFtsOverride(null);
});

describe('notes: etiquetas anidadas', () => {
  it('normaliza con barra y sin barras de más', () => {
    expect(normalizeTag(' Trabajo / Clientes ')).toBe('trabajo/clientes');
    expect(normalizeTag('#a//b/')).toBe('a/b');
    expect(normalizeTag('/x')).toBe('x');
  });

  it('arma el árbol con padres implícitos y cuenta cada nota una vez', async () => {
    const { o } = await owner();
    await createNote(o, { title: 'A', tags: ['trabajo/clientes', 'trabajo/ventas'] });
    await createNote(o, { title: 'B', tags: ['trabajo/clientes'] });
    await createNote(o, { title: 'C', tags: ['casa'] });
    const tags = await listTags(o);
    expect(tags).toEqual(
      expect.arrayContaining([
        { tag: 'trabajo', count: 2 },
        { tag: 'trabajo/clientes', count: 2 },
        { tag: 'trabajo/ventas', count: 1 },
        { tag: 'casa', count: 1 },
      ]),
    );
    const tree = buildTagTree(tags);
    expect(tree.map((n) => [n.tag, n.depth])).toEqual([
      ['casa', 0],
      ['trabajo', 0],
      ['trabajo/clientes', 1],
      ['trabajo/ventas', 1],
    ]);
    expect(tree.find((n) => n.tag === 'trabajo')?.hasChildren).toBe(true);
    // Filtrar por el padre trae las de las hijas.
    expect((await listNotes(o, { tag: 'trabajo' })).map((n) => n.title).sort()).toEqual(['A', 'B']);
  });

  it('renombra y borra una etiqueta con sus hijas en todas las notas', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'X', tags: ['proyectos/alfa', 'otra'] });
    expect(await renameTag(o, 'proyectos', 'work/proj')).toBe(1);
    expect((await getNote(o, n.id))!.tags).toEqual(['work/proj/alfa', 'otra']);
    expect(await deleteTag(o, 'work')).toBe(1);
    expect((await getNote(o, n.id))!.tags).toEqual(['otra']);
    expect(renameTagIn(['a', 'a/b', 'ab'], 'a', 'z')).toEqual(['z', 'z/b', 'ab']);
    expect(removeTagFrom(['a', 'a/b', 'ab'], 'a')).toEqual(['ab']);
  });
});

describe('notes: pilas de libretas', () => {
  it('agrupa libretas en pilas, filtra por pila, renombra y deshace', async () => {
    const { o } = await owner();
    const a = await createNotebook(o, 'Clientes', 'Trabajo');
    const b = await createNotebook(o, 'Ideas');
    await setNotebookStack(o, b.id, 'Trabajo');
    const c = await createNotebook(o, 'Recetas');
    await createNote(o, { title: 'en a', notebook_id: a.id });
    await createNote(o, { title: 'en b', notebook_id: b.id });
    await createNote(o, { title: 'en c', notebook_id: c.id });
    expect((await listNotes(o, { stack: 'Trabajo' })).map((n) => n.title).sort()).toEqual(['en a', 'en b']);
    const grouped = groupNotebooks(await listNotebooks(o));
    expect(grouped.stacks).toEqual([{ stack: 'Trabajo', notebooks: expect.any(Array) }]);
    expect(grouped.loose.map((n) => n.name)).toEqual(['Recetas']);
    expect(await renameStack(o, 'Trabajo', 'Laburo')).toBe(2);
    expect((await listNotebooks(o)).filter((n) => n.stack === 'Laburo')).toHaveLength(2);
    await renameStack(o, 'Laburo', null);
    expect((await listNotebooks(o)).every((n) => !n.stack)).toBe(true);
  });

  it('no toca libretas de otra persona', async () => {
    const { o } = await owner();
    const { o: other } = await owner('npar-other');
    const nb = await createNotebook(other, 'Ajena', 'Suya');
    expect(await setNotebookStack(o, nb.id, 'Mía')).toBe(false);
    expect(await renameStack(o, 'Suya', 'Mía')).toBe(0);
  });
});

describe('notes: plantillas y búsquedas guardadas', () => {
  it('CRUD de plantillas, sin adjuntos y solo de la persona', async () => {
    const { o } = await owner();
    const { o: other } = await owner('npar-other');
    const tpl = await createNoteTemplate(o, {
      name: 'Reunión semanal',
      title: 'Semanal',
      content: [para('Agenda'), { id: 'f1', type: 'image', content: '', url: '/uploads/docs/x.png', name: 'x.png' }],
    });
    expect(tpl.content).toHaveLength(1);
    expect((await listNoteTemplates(o)).map((t) => t.name)).toEqual(['Reunión semanal']);
    expect(await listNoteTemplates(other)).toEqual([]);
    expect(await renameNoteTemplate(other, tpl.id, 'robada')).toBe(false);
    expect(await renameNoteTemplate(o, tpl.id, 'Semanal')).toBe(true);
    expect(await deleteNoteTemplate(other, tpl.id)).toBe(false);
    expect(await deleteNoteTemplate(o, tpl.id)).toBe(true);
    expect(getNoteBuiltinTemplates('es').map((t) => t.key)).toContain('meeting');
  });

  it('rutas de plantillas: crear y borrar con sesión', async () => {
    const { user } = await owner();
    session.user = { id: user.id, email: user.email };
    const res = await tplRoute.POST(jsonReq('http://x/api/notes/templates', 'POST', { name: 'Diario', content: [para('hoy')] }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    expect(((await (await tplRoute.GET()).json()) as { templates: unknown[] }).templates).toHaveLength(1);
    expect((await tplIdRoute.DELETE(jsonReq('http://x', 'DELETE'), ctx(created.id))).status).toBe(204);
  });

  it('búsquedas guardadas: crear, buscar por nombre, actualizar y borrar', async () => {
    const { o } = await owner();
    const s = await createSavedSearch(o, { name: 'Pendientes de trabajo', query: 'tag:trabajo todo:false' });
    expect((await searchSavedSearches(o, 'pendientes')).map((x) => x.id)).toEqual([s.id]);
    expect((await updateSavedSearch(o, s.id, { query: 'tag:trabajo' }))?.query).toBe('tag:trabajo');
    expect(await deleteSavedSearch(o, s.id)).toBe(true);
    expect(await listSavedSearches(o)).toEqual([]);
  });
});

describe('notes: varias notas a la vez', () => {
  it('mueve, etiqueta, fija, manda a la papelera y borra solo las propias', async () => {
    const { o } = await owner();
    const { o: other } = await owner('npar-other');
    const nb = await createNotebook(o, 'Destino');
    const a = await createNote(o, { title: 'a' });
    const b = await createNote(o, { title: 'b' });
    const ajena = await createNote(other, { title: 'ajena' });
    expect(await bulkNotes(o, [a.id, b.id, ajena.id], 'move', { notebookId: nb.id })).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await getNote(other, ajena.id))!.notebook_id).toBeNull();
    expect((await bulkNotes(o, [a.id, b.id], 'tag', { tag: 'Lote/Uno' })).length).toBe(2);
    expect((await getNote(o, a.id))!.tags).toEqual(['lote/uno']);
    await bulkNotes(o, [a.id], 'pin');
    expect((await getNote(o, a.id))!.pinned).toBe(true);
    // Borrar para siempre solo desde la papelera.
    expect(await bulkNotes(o, [a.id], 'delete')).toEqual([]);
    await bulkNotes(o, [a.id, b.id], 'trash');
    expect(await bulkNotes(o, [a.id, b.id], 'delete')).toHaveLength(2);
    expect(await getNote(o, a.id)).toBeNull();
  });

  it('la ruta valida la acción y pide sesión', async () => {
    expect((await bulkRoute.POST(jsonReq('http://x/api/notes/bulk', 'POST', { ids: ['x'], action: 'trash' }))).status).toBe(401);
    const { user } = await owner();
    session.user = { id: user.id, email: user.email };
    expect((await bulkRoute.POST(jsonReq('http://x/api/notes/bulk', 'POST', { ids: ['x'], action: 'move' }))).status).toBe(400);
    expect((await bulkRoute.POST(jsonReq('http://x/api/notes/bulk', 'POST', { ids: ['x'], action: 'nope' }))).status).toBe(400);
  });
});

describe('notes: notas bloqueadas con contraseña', () => {
  it('cifra en el cliente y abre solo con la contraseña correcta', async () => {
    const key = await newNoteKey('correcta', 100_000);
    const env = await sealNote(key, { title: 'Claves', content: [para('wifi: secreto123')] }, 'la de siempre');
    expect(env.ct).not.toContain('secreto123');
    expect(atob(env.ct)).not.toContain('secreto123');
    expect(env.hint).toBe('la de siempre');
    const opened = await openNote('correcta', env);
    expect(opened.payload.content[0].content).toBe('wifi: secreto123');
    await expect(openNote('incorrecta', env)).rejects.toBeInstanceOf(WrongPasswordError);
    // Cada guardado usa un IV nuevo.
    const again = await sealNote(key, { title: 'Claves', content: [para('wifi: secreto123')] });
    expect(again.iv).not.toBe(env.iv);
    expect((await openNoteWithKey(key, again)).title).toBe('Claves');
  });

  it('el servidor nunca guarda el texto: ni contenido, ni búsqueda, ni versiones, ni link público', async () => {
    const { user, o } = await owner();
    const n = await createNote(o, { title: 'Banco', content: [para('pin 4455'), { id: 'img1', type: 'image', content: '', url: '/uploads/docs/a.png', name: 'a.png', mime: 'image/png' }] });
    await updateNote(o, n.id, { content: [para('pin 4455 y clave 9988')] });
    await setNoteShared(o, n.id, true);
    const key = await newNoteKey('pw-segura', 100_000);
    const latest = (await getNote(o, n.id))!;
    const env = await sealNote(key, { title: latest.title, content: latest.content });
    session.user = { id: user.id, email: user.email };
    const res = await lockRoute.POST(
      jsonReq('http://x', 'POST', { action: 'lock', lock: env, content: fileBlocksOnly(latest.content), base_updated_at: latest.updated_at }),
      ctx(n.id),
    );
    expect(res.status).toBe(200);
    const row = (await getDb().prepare('SELECT * FROM notes WHERE id = ?').get(n.id)) as Record<string, string>;
    expect(row.body_text).toBe('');
    expect(row.content).not.toContain('4455');
    expect(row.share_token).toBeNull();
    expect(JSON.stringify(row)).not.toContain('9988');
    const versions = (await getDb().prepare('SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?').get(n.id)) as { n: number };
    expect(Number(versions.n)).toBe(0);
    // No aparece buscando su texto, sí por el título; no se publica por link.
    expect(await listNotes(o, { q: '4455' })).toEqual([]);
    const found = await listNotes(o, { q: 'Banco' });
    expect(found[0]).toMatchObject({ locked: true, snippet: '' });
    expect(await setNoteShared(o, n.id, true)).toBe(false);
    // Guardar contenido sin el sobre se rechaza (409 en la ruta).
    await expect(updateNote(o, n.id, { content: [para('en claro')] })).rejects.toBeInstanceOf(NotesError);
    const patchRes = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { content: [para('en claro')] }), ctx(n.id));
    expect(patchRes.status).toBe(409);
    // Editar bloqueada: sobre nuevo + solo los adjuntos.
    const edited = await sealNote(key, { title: 'Banco', content: [para('pin 1111')] });
    // Sin la prueba de la contraseña (o con otra clave) no se acepta otro sobre.
    await expect(updateNote(o, n.id, { content: [], lock: edited })).rejects.toMatchObject({ code: 'wrong_password' });
    const otherKey = await newNoteKey('otra', 100_000);
    await expect(updateNote(o, n.id, { content: [], lock: await sealNote(otherKey, { title: 'x', content: [] }), lock_proof: otherKey.proof })).rejects.toMatchObject({
      code: 'wrong_password',
    });
    const badRes = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { content: [], lock: edited, lock_proof: otherKey.proof }), ctx(n.id));
    expect(badRes.status).toBe(403);
    // Sobre con otra forma (sin verificador, IV corto): 400.
    const malformed = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { content: [], lock: { ...edited, vh: undefined, iv: 'AAAA' }, lock_proof: key.proof }), ctx(n.id));
    expect(malformed.status).toBe(400);
    // Volver a bloquear una bloqueada (pisar el sobre sin prueba) tampoco.
    await expect(lockNote(o, n.id, { lock: edited, content: [] })).rejects.toMatchObject({ code: 'note_locked' });
    const saved = await updateNote(o, n.id, {
      content: fileBlocksOnly([para('pin 1111')]),
      lock: edited,
      lock_proof: key.proof,
      base_updated_at: (await getNote(o, n.id))!.updated_at,
    });
    expect(saved!.lock?.iv).toBe(edited.iv);
    // El export no saca el texto.
    expect((await exportRoute.GET(jsonReq('http://x/api/notes/x/export?format=md', 'GET') as never, ctx(n.id))).status).toBe(409);
    // Sacar el bloqueo vuelve a guardar en claro.
    const opened = await openNoteWithKey(key, saved!.lock!);
    await expect(unlockNote(o, n.id, { title: opened.title, content: opened.content, proof: otherKey.proof })).rejects.toMatchObject({ code: 'wrong_password' });
    const plain = await unlockNote(o, n.id, { title: opened.title, content: opened.content, proof: key.proof });
    expect(plain!.locked).toBe(false);
    expect((await listNotes(o, { q: '1111' })).map((x) => x.id)).toEqual([n.id]);
  });

  it('el link público de una nota bloqueada deja de funcionar', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'Pública', content: [para('hola')] });
    const token = (await setNoteShared(o, n.id, true)) as string;
    expect(await getSharedNote(token)).not.toBeNull();
    const key = await newNoteKey('xxxx', 100_000);
    await lockNote(o, n.id, { lock: await sealNote(key, { title: 'Pública', content: n.content }), content: [] });
    expect(await getSharedNote(token)).toBeNull();
  });
});

describe('notes: exportar a ENEX y HTML', () => {
  it('ida y vuelta: lo que exporta lo vuelve a leer el importador', () => {
    const note: NoteDetail = {
      id: 'n1',
      notebook_id: null,
      title: 'Compras & <cosas>',
      snippet: '',
      tags: ['casa', 'super/semana'],
      pinned: false,
      trashed: false,
      source_url: 'https://example.com/a?b=1&c=2',
      shared: false,
      share_token: null,
      created_at: '2026-01-02T03:04:05.000Z',
      updated_at: '2026-01-03T03:04:05.000Z',
      content: [
        { id: 'h', type: 'heading', level: 2, content: 'Lista' },
        todo('<strong>leche</strong>', true),
        todo('pan'),
        { id: 'b1', type: 'bulleted_list_item', content: 'uno&nbsp;dos' },
        { id: 'c', type: 'code', content: 'if (a < b) {}' },
        { id: 'img', type: 'image', content: '', url: '/uploads/docs/x.png', name: 'x.png', mime: 'image/png' },
        para('<a href="https://zerosoft.ai">link</a> ]]&gt; fin'),
      ],
    };
    const res = enexResource(new Uint8Array([1, 2, 3]), 'image/png', 'x.png');
    const xml = ENEX_HEAD('2026-10-27T00:00:00.000Z') + noteToEnex(note, { files: new Map([['img', res]]) }) + ENEX_TAIL;
    const parsed = parseEnex(xml);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Compras & <cosas>');
    expect(parsed[0].tags).toEqual(['casa', 'super/semana']);
    expect(parsed[0].sourceUrl).toBe('https://example.com/a?b=1&c=2');
    expect(parsed[0].createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(parsed[0].resources).toHaveLength(1);
    const blocks = enmlToBlocks(parsed[0].enNote!);
    const todos = blocks.filter((b) => b.type === 'todo');
    expect(todos.map((b) => b.checked)).toEqual([true, false]);
    expect(blocks.some((b) => b.type === 'code' && /a (<|&lt;) b/.test(b.content))).toBe(true);
    expect(blocks.some((b) => b.content.includes('fin') && b.content.includes('zerosoft.ai'))).toBe(true);
  });

  it('una nota bloqueada sale sin el texto', () => {
    const xml = noteToEnex({ id: 'x', notebook_id: null, title: 'T', snippet: '', tags: [], pinned: false, trashed: false, source_url: null, shared: false, share_token: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', content: [para('secreto')], locked: true }, { lockedText: 'Bloqueada' });
    expect(xml).not.toContain('secreto');
    expect(xml).toContain('Bloqueada');
  });

  it('ENML solo con marcas simples y HTML con checkboxes', () => {
    expect(inlineToEnml('<span style="x">a</span><b onclick="y">b</b><a href="javascript:alert(1)">c</a>')).toBe('a<b>b</b><a>c</a>');
    expect(blocksToEnml([todo('x', true)], () => null, () => null)).toContain('<en-todo checked="true"/>');
    const html = noteToHtml({ id: 'x', notebook_id: null, title: 'T', snippet: '', tags: ['a'], pinned: false, trashed: false, source_url: null, shared: false, share_token: null, created_at: '', updated_at: '', content: [todo('hecho', true)] });
    expect(html).toContain('<input type="checkbox" checked disabled>');
  });
});

describe('notes: offline', () => {
  const cached = (over: Partial<CachedNote>): CachedNote => ({
    id: crypto.randomUUID(),
    notebook_id: null,
    title: '',
    snippet: '',
    tags: [],
    pinned: false,
    trashed: false,
    source_url: null,
    shared: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('lista, filtra y busca sobre la copia del dispositivo', () => {
    const all = [
      cached({ title: 'Compras', content: [para('leche y pan')], tags: ['casa'], updated_at: '2026-01-03T00:00:00Z' }),
      cached({ title: 'Trabajo', tags: ['work/clients'], pinned: true }),
      cached({ title: 'Vieja', trashed: true }),
      cached({ title: 'Banco', locked: true, content: [] }),
    ];
    expect(offlineList(all, { kind: 'all' }, '', 'updated', []).map((n) => n.title)).toEqual(['Trabajo', 'Compras', 'Banco']);
    expect(offlineList(all, { kind: 'all' }, 'pan', 'updated', []).map((n) => n.title)).toEqual(['Compras']);
    expect(offlineList(all, { kind: 'tag', tag: 'work' }, '', 'updated', []).map((n) => n.title)).toEqual(['Trabajo']);
    expect(offlineList(all, { kind: 'trash' }, '', 'updated', []).map((n) => n.title)).toEqual(['Vieja']);
    expect(offlineList(all, { kind: 'all' }, 'tag:casa', 'updated', []).map((n) => n.title)).toEqual(['Compras']);
  });

  it('la cola fusiona guardados (mismo opId, rev nueva) y mete los cambios en el alta offline', () => {
    let ops: OutboxOp[] = [];
    ops = mergeIntoOutbox(ops, makeOp({ kind: 'patch', id: 'a', patch: { title: '1' }, base: 'b0' }, 1));
    const first = ops[0].opId;
    ops = mergeIntoOutbox(ops, makeOp({ kind: 'patch', id: 'a', patch: { content: [] }, base: 'b1' }, 2));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ opId: first, rev: 1, base: 'b0', patch: { title: '1', content: [] } });
    ops = mergeIntoOutbox(ops, makeOp({ kind: 'create', id: 'n', body: { title: '' } }, 3));
    ops = mergeIntoOutbox(ops, makeOp({ kind: 'patch', id: 'n', patch: { title: 'nueva' }, base: null }, 4));
    expect(ops).toHaveLength(2);
    expect(ops[1]).toMatchObject({ kind: 'create', body: { title: 'nueva' }, rev: 1 });
    ops = mergeIntoOutbox(ops, makeOp({ kind: 'patch', id: 'n', patch: { trashed: true }, base: null }, 5));
    expect(ops[2]).toMatchObject({ kind: 'patch', patch: { trashed: true } });
    expect(new Set(ops.map((o) => o.opId)).size).toBe(3);
  });

  type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
  const res = (status: number, body: unknown = {}): FakeRes => ({ ok: status < 300, status, json: async () => body });
  function deps(handler: (url: string, init: RequestInit) => FakeRes) {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const completed: Array<[string, string | null]> = [];
    const stuck: Array<[string, number]> = [];
    return {
      calls,
      completed,
      stuck,
      d: {
        fetch: async (url: string, init: RequestInit) => {
          calls.push({ url, method: String(init.method), body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
          return handler(url, init);
        },
        complete: async (op: OutboxOp, at: string | null) => void completed.push([op.opId, at]),
        stuck: async (op: OutboxOp, status: number) => void stuck.push([op.opId, status]),
        copyTitle: (t: string) => `${t} (copia offline)`,
      },
    };
  }

  it('al volver la red reenvía en orden y un choque queda como copia, sin pisar', async () => {
    const ops: OutboxOp[] = [
      makeOp({ kind: 'create', id: 'n1', body: { title: 'offline' } }, 1),
      makeOp({ kind: 'patch', id: 'n2', patch: { title: 'mía', content: [para('x')] }, base: 'old' }, 2),
    ];
    const t = deps((url, init) =>
      init.method === 'PATCH' ? res(409, { note: { title: 'servidor', notebook_id: 'nb', tags: ['t'] } }) : res(201, { updated_at: 'u1' }),
    );
    const r = await replayOutbox(ops, t.d);
    expect(r).toMatchObject({ done: 1, copies: 1, stuck: 0, remaining: 0 });
    expect(t.calls[1].body).toMatchObject({ base_updated_at: 'old' });
    expect(t.calls[2]).toMatchObject({ url: '/api/notes', body: { title: 'mía (copia offline)', notebook_id: 'nb', tags: ['t'] } });
    expect(t.completed).toEqual([
      [ops[0].opId, 'u1'],
      [ops[1].opId, null],
    ]);
  });

  it('sin versión conocida no pisa: el texto queda como copia (nunca un PATCH a ciegas)', async () => {
    const ops: OutboxOp[] = [makeOp({ kind: 'patch', id: 'n', patch: { content: [para('mío')] }, base: null })];
    const t = deps((url, init) => (init.method === 'GET' ? res(200, { title: 'del servidor', tags: [] }) : res(201)));
    const r = await replayOutbox(ops, t.d);
    expect(r.copies).toBe(1);
    expect(t.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(t.calls[1].body).toMatchObject({ title: 'del servidor (copia offline)' });
  });

  it('una bloqueada que choca queda como copia bloqueada con el mismo sobre', async () => {
    const lock = { v: 1, iter: 100000, salt: 's', iv: 'i', ct: 'c', vh: 'v' };
    const ops: OutboxOp[] = [makeOp({ kind: 'patch', id: 'n', patch: { content: [], lock, lock_proof: 'p' }, base: 'old' })];
    const t = deps((url, init) => (init.method === 'PATCH' ? res(409, { note: { title: 'T' } }) : res(201)));
    const r = await replayOutbox(ops, t.d);
    expect(r.copies).toBe(1);
    const lockCall = t.calls.find((c) => c.url.endsWith('/lock'));
    expect(lockCall?.body).toMatchObject({ action: 'lock', lock });
    expect(JSON.stringify(t.calls[1].body)).not.toContain('"lock"');
  });

  it('5xx y 429 se reintentan (no se descarta nada); 403/404 quedan apartados', async () => {
    const ops: OutboxOp[] = [
      makeOp({ kind: 'patch', id: 'a', patch: { title: 'x' }, base: 'b' }, 1),
      makeOp({ kind: 'patch', id: 'b', patch: { title: 'y' }, base: 'b' }, 2),
    ];
    const down = deps(() => res(503));
    const r1 = await replayOutbox(ops, down.d);
    expect(r1).toMatchObject({ remaining: 2, retry: true });
    expect(down.completed).toEqual([]);
    const gone = deps((url) => (url.endsWith('/a') ? res(404) : res(200, { updated_at: 'u' })));
    const r2 = await replayOutbox(ops, gone.d);
    expect(r2).toMatchObject({ done: 1, stuck: 1, remaining: 0 });
    expect(gone.stuck).toEqual([[ops[0].opId, 404]]);
    expect(stuckFrom(makeOp({ kind: 'patch', id: 'a', patch: { title: 'T', content: [para('texto <b>x</b>')] }, base: 'b' }), 404)).toMatchObject({
      title: 'T',
      text: 'texto x',
    });
    expect(retryDelay(0)).toBe(5000);
    expect(retryDelay(10)).toBe(300000);
  });

  it('sin red se detiene y deja lo que falta', async () => {
    const ops: OutboxOp[] = [makeOp({ kind: 'create', id: 'a', body: {} })];
    const t = deps(() => {
      throw new TypeError('offline');
    });
    const r = await replayOutbox(ops, t.d);
    expect(r.remaining).toBe(1);
    expect(r.retry).toBe(false);
  });

  it('la copia del dispositivo solo se abre con la cookie de la persona confirmada', () => {
    const rec = { who: 'abc', at: Date.now() };
    expect(identityMatches(rec, 'abc')).toBe(true);
    expect(identityMatches(rec, 'otra')).toBe(false);
    expect(identityMatches(rec, null)).toBe(false);
    expect(identityMatches(null, 'abc')).toBe(false);
    expect(identityMatches({ who: 'abc', at: Date.now() - 31 * 86_400_000 }, 'abc')).toBe(false);
  });

  it('aplica un cambio local a la copia', () => {
    const n = applyPatchLocally(cached({ title: 'a' }), { title: 'b', pinned: true, content: [para('z')] }, '2026-02-01T00:00:00Z');
    expect(n).toMatchObject({ title: 'b', pinned: true, full: true, updated_at: '2026-02-01T00:00:00Z' });
  });

  it('la sync baja notas completas, el índice con papelera y solo las propias', async () => {
    const { user, o } = await owner();
    const { o: other } = await owner('npar-other');
    const a = await createNote(o, { title: 'una', content: [para('texto')] });
    const b = await createNote(o, { title: 'otra' });
    await bulkNotes(o, [b.id], 'trash');
    await createNote(other, { title: 'ajena' });
    const { notes, index } = await listNotesForSync(o);
    expect(notes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(notes.find((n) => n.id === a.id)?.content[0].content).toBe('texto');
    expect(index.find((n) => n.id === b.id)?.trashed).toBe(true);
    const later = await listNotesForSync(o, { since: new Date(Date.now() + 60_000).toISOString() });
    expect(later.notes).toEqual([]);
    expect(later.index).toHaveLength(2);
    session.user = { id: user.id, email: user.email };
    const res = await syncRoute.GET(new NextRequest('http://x/api/notes/sync'));
    expect(res.status).toBe(200);
  });
});

describe('notes: escaneo, selección y resaltado', () => {
  it('la homografía lleva cada esquina a su lugar', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const to = [
      { x: 2, y: 1 },
      { x: 30, y: 3 },
      { x: 28, y: 40 },
      { x: 1, y: 35 },
    ];
    const h = homography(from, to);
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h, from[i]);
      expect(p.x).toBeCloseTo(to[i].x, 5);
      expect(p.y).toBeCloseTo(to[i].y, 5);
    }
  });

  it('endereza y limpia la imagen', () => {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([i % 2 ? 200 : 60, 120, 90, 255], i * 4);
    const out = warpQuad({ width: w, height: h, data }, [{ x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 19 }, { x: 0, y: 19 }], 10, 10);
    expect(out.data).toHaveLength(400);
    const clean = enhanceDocument(out);
    expect(clean.data[0]).toBe(clean.data[1]);
    expect(Math.max(...Array.from(clean.data.filter((_, i) => i % 4 === 0)))).toBe(255);
  });

  it('selección con ⌘ y Shift, y términos a resaltar', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(nextSelection([], ids, 'b', 'toggle', null)).toEqual(['b']);
    expect(nextSelection(['b'], ids, 'b', 'toggle', null)).toEqual([]);
    expect(nextSelection(['b'], ids, 'd', 'range', 'b')).toEqual(['b', 'c', 'd']);
    expect(highlightTerms('tag:casa leche notebook:"Mi libreta" pan')).toEqual(['leche', 'pan']);
  });
});
