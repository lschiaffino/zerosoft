import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAiModelOverride } from '@/lib/ai';
import { getDb } from '@/lib/db';
import {
  askNotes,
  createNote,
  createNotebook,
  deleteNotebook,
  getNote,
  getSharedNote,
  listNotebooks,
  listNotes,
  listTags,
  noteOwner,
  rankNotesForQuestion,
  setNoteShared,
  setNotesFtsOverride,
  trashNote,
  updateNote,
  type NoteOwner,
} from '@/lib/notes';
import { blocksToText, clipBlocks, normalizeTag } from '@/lib/notes-types';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';
import { failingModel, mockModel } from './ai-mock';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const notesRoute = await import('@/app/api/notes/route');
const noteRoute = await import('@/app/api/notes/[id]/route');
const shareRoute = await import('@/app/api/notes/[id]/share/route');
const askRoute = await import('@/app/api/notes/ask/route');
const clipRoute = await import('@/app/api/notes/clip/route');

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function para(text: string): DocsBlock {
  return { id: crypto.randomUUID(), type: 'paragraph', content: text };
}

async function ownerPair() {
  const boss = await makeUser('boss');
  const mate = await makeUser('mate');
  // Mismo workspace (el del owner), personas distintas.
  const a: NoteOwner = { workspaceId: boss.id, personId: boss.id };
  const b: NoteOwner = { workspaceId: boss.id, personId: mate.id };
  return { boss, mate, a, b };
}

const AI_ENV = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of AI_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AI_FREE_TOKENS_PER_MONTH = 'unlimited';
  session.user = null;
  setNotesFtsOverride(null);
});

afterEach(() => {
  setAiModelOverride(null);
  setNotesFtsOverride(null);
  for (const k of AI_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('notes: helpers puros', () => {
  it('blocksToText marca checklists y saca HTML', () => {
    const text = blocksToText([
      { id: '1', type: 'heading', level: 1, content: 'Plan &amp; <strong>todo</strong>' },
      { id: '2', type: 'todo', checked: true, content: 'milk' },
      { id: '3', type: 'todo', checked: false, content: 'eggs' },
    ]);
    expect(text).toBe('Plan & todo\n[x] milk\n[ ] eggs');
  });

  it('normalizeTag', () => {
    expect(normalizeTag('  #Work Stuff ')).toBe('work-stuff');
    expect(normalizeTag('<x>')).toBe('x');
  });

  it('clipBlocks escapa la URL y la selección', () => {
    const blocks = clipBlocks('https://e.com/?a=1&b="2"', 'hola <b>x</b>\n\nsegundo');
    expect(blocks[0].content).toContain('&amp;b=&quot;2&quot;');
    expect(blocks[1]).toMatchObject({ type: 'quote', content: 'hola &lt;b&gt;x&lt;/b&gt;' });
    expect(blocks[2]).toMatchObject({ type: 'quote', content: 'segundo' });
  });
});

describe('notes: CRUD y privacidad', () => {
  it('crea, edita, fija y lista; las notas son de la persona, no del workspace', async () => {
    const { a, b } = await ownerPair();
    const n = await createNote(a, { title: 'Groceries', content: [para('milk and <em>bread</em>')], tags: ['Home', 'home'] });
    expect(n.tags).toEqual(['home']);
    expect(n.snippet).toBe('milk and bread');

    const updated = await updateNote(a, n.id, { pinned: true, content: [para('only coffee')] });
    expect(updated?.pinned).toBe(true);
    expect(updated?.snippet).toBe('only coffee');

    const listA = await listNotes(a);
    expect(listA.map((x) => x.id)).toContain(n.id);
    // Otra persona del MISMO workspace no la ve ni la puede tocar.
    expect((await listNotes(b)).map((x) => x.id)).not.toContain(n.id);
    expect(await getNote(b, n.id)).toBeNull();
    expect(await updateNote(b, n.id, { title: 'hacked' })).toBeNull();
    expect(await trashNote(b, n.id)).toBe(false);
    expect((await getNote(a, n.id))?.title).toBe('Groceries');
  });

  it('las rutas usan la persona real (actingUser) dentro del team', async () => {
    const { boss, mate } = await ownerPair();
    session.user = { id: boss.id, email: boss.email, actingUser: { id: mate.id } };
    const res = await notesRoute.POST(jsonReq('http://x/api/notes', 'POST', { title: 'Mate secret' }));
    expect(res.status).toBe(201);
    const note = await res.json();

    session.user = { id: boss.id, email: boss.email }; // el owner del workspace
    const get = await noteRoute.GET(jsonReq(`http://x/api/notes/${note.id}`, 'GET'), ctx(note.id));
    expect(get.status).toBe(404);
    const list = await (await notesRoute.GET(Object.assign(jsonReq('http://x/api/notes', 'GET'), {
      nextUrl: new URL('http://x/api/notes'),
    }))).json();
    expect(list.notes.map((x: { id: string }) => x.id)).not.toContain(note.id);
    expect(noteOwner({ id: boss.id, actingUser: { id: mate.id } })).toEqual({ workspaceId: boss.id, personId: mate.id });
  });

  it('creación optimista: acepta id del cliente y rechaza uno ya usado (aunque sea de otra persona)', async () => {
    const { boss, mate } = await ownerPair();
    const id = crypto.randomUUID();
    session.user = { id: boss.id, email: boss.email };
    const ok = await notesRoute.POST(jsonReq('http://x/api/notes', 'POST', { id, title: 'mine' }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).id).toBe(id);
    session.user = { id: boss.id, email: boss.email, actingUser: { id: mate.id } };
    const dup = await notesRoute.POST(jsonReq('http://x/api/notes', 'POST', { id, title: 'steal' }));
    expect(dup.status).toBe(409);
    const bad = await notesRoute.POST(jsonReq('http://x/api/notes', 'POST', { id: 'not-a-uuid' }));
    expect(bad.status).toBe(400);
  });

  it('valida el body con zod', async () => {
    const u = await makeUser('z');
    session.user = { id: u.id, email: u.email };
    const res = await notesRoute.POST(jsonReq('http://x/api/notes', 'POST', { tags: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('libretas: crear, mover, contar y borrar (las notas van a la papelera)', async () => {
    const { a, b } = await ownerPair();
    const nb = await createNotebook(a, 'Work');
    const n = await createNote(a, { title: 'Standup' });
    await updateNote(a, n.id, { notebook_id: nb.id });
    expect((await listNotebooks(a)).find((x) => x.id === nb.id)?.count).toBe(1);
    expect(await listNotebooks(b)).toEqual([]);
    // No se puede mover a una libreta ajena.
    const nbB = await createNotebook(b, 'Mine');
    await expect(updateNote(a, n.id, { notebook_id: nbB.id })).rejects.toThrow('notebook_not_found');
    expect((await listNotes(a, { notebookId: nb.id })).map((x) => x.id)).toEqual([n.id]);
    expect(await deleteNotebook(b, nb.id)).toBe(false);
    expect(await deleteNotebook(a, nb.id)).toBe(true);
    expect((await getNote(a, n.id))?.trashed).toBe(true);
  });

  it('tags: lista con conteos y filtro', async () => {
    const u = await makeUser('t');
    const o = noteOwner(u);
    await createNote(o, { title: 'a', tags: ['x', 'y'] });
    await createNote(o, { title: 'b', tags: ['x'] });
    expect(await listTags(o)).toEqual([
      { tag: 'x', count: 2 },
      { tag: 'y', count: 1 },
    ]);
    expect((await listNotes(o, { tag: 'y' })).map((n) => n.title)).toEqual(['a']);
  });

  it('orden por título y creación', async () => {
    const u = await makeUser('s');
    const o = noteOwner(u);
    await createNote(o, { title: 'beta' });
    await createNote(o, { title: 'Alpha' });
    expect((await listNotes(o, { sort: 'title' })).map((n) => n.title)).toEqual(['Alpha', 'beta']);
  });
});

describe('notes: papelera', () => {
  it('trash → restore → trash → delete forever (solo desde la papelera)', async () => {
    const u = await makeUser('tr');
    session.user = { id: u.id, email: u.email };
    const o = noteOwner(u);
    const n = await createNote(o, { title: 'Old' });

    const del1 = await noteRoute.DELETE(jsonReq(`http://x/api/notes/${n.id}`, 'DELETE'), ctx(n.id));
    expect(del1.status).toBe(409); // no está en la papelera

    await noteRoute.PATCH(jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { trashed: true }), ctx(n.id));
    expect((await listNotes(o)).map((x) => x.id)).not.toContain(n.id);
    expect((await listNotes(o, { view: 'trash' })).map((x) => x.id)).toContain(n.id);

    await noteRoute.PATCH(jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { trashed: false }), ctx(n.id));
    expect((await listNotes(o)).map((x) => x.id)).toContain(n.id);

    await trashNote(o, n.id);
    const del2 = await noteRoute.DELETE(jsonReq(`http://x/api/notes/${n.id}`, 'DELETE'), ctx(n.id));
    expect(del2.status).toBe(204);
    expect(await getNote(o, n.id)).toBeNull();
  });
});

describe('notes: búsqueda', () => {
  async function seed() {
    const u = await makeUser('q');
    const o = noteOwner(u);
    const other = noteOwner(await makeUser('q2'));
    await createNote(o, { title: 'Café recipes', content: [para('Grind the beans fine')] });
    await createNote(o, { title: 'Trip', content: [para('Book the hotel in Lisbon')] });
    await createNote(other, { title: 'Lisbon too', content: [para('not yours')] });
    return o;
  }

  for (const mode of ['fts', 'like'] as const) {
    it(`encuentra por título y cuerpo, con prefijo y sin acentos (${mode})`, async () => {
      setNotesFtsOverride(mode === 'fts');
      const o = await seed();
      expect((await listNotes(o, { q: 'lisbon' })).map((n) => n.title)).toEqual(['Trip']);
      expect((await listNotes(o, { q: 'bean' })).map((n) => n.title)).toEqual(['Café recipes']);
      expect((await listNotes(o, { q: 'grind fine' })).map((n) => n.title)).toEqual(['Café recipes']);
      expect(await listNotes(o, { q: 'grind hotel' })).toEqual([]);
      expect((await listNotes(o, { q: 'lisbon' }))[0].snippet).toContain('Lisbon');
      if (mode === 'fts') expect((await listNotes(o, { q: 'cafe' })).map((n) => n.title)).toEqual(['Café recipes']);
    });
  }

  it('la tabla FTS existe en la base de test (libsql trae FTS5)', async () => {
    const row = await getDb().prepare("SELECT name FROM sqlite_master WHERE name = 'notes_fts'").get();
    expect(row).toBeTruthy();
  });

  it('el índice se actualiza al editar y al borrar', async () => {
    const o = noteOwner(await makeUser('qi'));
    const n = await createNote(o, { title: 'zebra' });
    await updateNote(o, n.id, { title: 'giraffe' });
    expect(await listNotes(o, { q: 'zebra' })).toEqual([]);
    expect((await listNotes(o, { q: 'giraffe' })).length).toBe(1);
  });

  it('caracteres raros no rompen la consulta FTS', async () => {
    const o = noteOwner(await makeUser('qx'));
    await createNote(o, { title: 'hello world' });
    expect((await listNotes(o, { q: '"hello" (wor*' })).length).toBe(1);
    expect(await listNotes(o, { q: '***' })).toEqual([]);
  });
});

describe('notes: link público', () => {
  it('activa, lee por token y desactiva', async () => {
    const u = await makeUser('sh');
    session.user = { id: u.id, email: u.email };
    const n = await createNote(noteOwner(u), { title: 'Public', content: [para('hi')] });
    const res = await shareRoute.POST(jsonReq('http://x', 'POST', { shared: true }), ctx(n.id));
    const { share_token } = await res.json();
    expect(share_token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await getSharedNote(share_token))?.title).toBe('Public');
    await setNoteShared(noteOwner(u), n.id, false);
    expect(await getSharedNote(share_token)).toBeNull();
    expect(await getSharedNote('../../etc')).toBeNull();
  });

  it('otra persona no puede compartir mis notas; la papelera corta el link', async () => {
    const { a, b } = await ownerPair();
    const n = await createNote(a, { title: 'mine' });
    expect(await setNoteShared(b, n.id, true)).toBe(false);
    const token = (await setNoteShared(a, n.id, true)) as string;
    await trashNote(a, n.id);
    expect(await getSharedNote(token)).toBeNull();
  });
});

describe('notes: clip', () => {
  it('guarda la página con su URL de origen', async () => {
    const u = await makeUser('clip');
    session.user = { id: u.id, email: u.email };
    const res = await clipRoute.POST(
      jsonReq('http://x', 'POST', { url: 'https://example.com/a', title: 'Example', selection: 'quoted text' }),
    );
    expect(res.status).toBe(201);
    const note = await res.json();
    expect(note).toMatchObject({ title: 'Example', source_url: 'https://example.com/a', tags: ['clip'] });
    const bad = await clipRoute.POST(jsonReq('http://x', 'POST', { url: 'javascript:alert(1)' }));
    expect(bad.status).toBe(400);
  });
});

describe('notes: Ask AI', () => {
  it('rankea por palabras clave y solo sobre mis notas', async () => {
    const { a, b } = await ownerPair();
    await createNote(a, { title: 'Wifi password', content: [para('The office wifi password is hunter2')] });
    await createNote(a, { title: 'Recipes', content: [para('pasta')] });
    await createNote(b, { title: 'Wifi', content: [para('someone else wifi')] });
    const ranked = await rankNotesForQuestion(a, 'what is the wifi password?');
    expect(ranked.map((r) => r.title)).toEqual(['Wifi password']);
  });

  it('responde citando títulos (modelo mock)', async () => {
    const u = await makeUser('ask');
    const o = noteOwner(u);
    await createNote(o, { title: 'Wifi password', content: [para('hunter2')] });
    setAiModelOverride(mockModel('It is hunter2 (from "Wifi password").'));
    const res = await askNotes(o, 'wifi password?');
    expect(res).toMatchObject({ ok: true, sources: [{ title: 'Wifi password' }] });
  });

  it('sin AI configurada: 503 y el GET dice enabled=false', async () => {
    const u = await makeUser('noai');
    session.user = { id: u.id, email: u.email };
    expect(await (await askRoute.GET()).json()).toEqual({ enabled: false });
    const res = await askRoute.POST(jsonReq('http://x', 'POST', { question: 'anything here?' }));
    expect(res.status).toBe(503);
  });

  it('sin coincidencias no llama al modelo; si el modelo falla, ai_failed', async () => {
    const o = noteOwner(await makeUser('ask2'));
    await createNote(o, { title: 'Garden', content: [para('tomatoes')] });
    setAiModelOverride(failingModel());
    expect(await askNotes(o, 'quantum physics')).toEqual({ ok: false, code: 'no_matches' });
    expect(await askNotes(o, 'tomatoes?')).toEqual({ ok: false, code: 'ai_failed' });
  });
});

describe('feedback: Notes y Board como productos', () => {
  it('acepta feedback de notes/board y mapea la ruta', async () => {
    const { createFeedback } = await import('@/lib/feedback');
    const { productFromPath } = await import('@/lib/feedback-constants');
    const row = await createFeedback({ kind: 'idea', product: 'notes', message: 'love it' });
    expect(row.product).toBe('notes');
    expect((await createFeedback({ kind: 'bug', product: 'board', message: 'x' })).product).toBe('board');
    expect(productFromPath('/es/app/notes')).toBe('notes');
    expect(productFromPath('/app/board/123')).toBe('board');
  });
});
