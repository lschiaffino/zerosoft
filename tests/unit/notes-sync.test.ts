import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  NotesConflictError,
  NotesError,
  createNote,
  getNote,
  searchNotesForPalette,
  setNotesFtsOverride,
  trashNote,
  updateNote,
  type NoteOwner,
} from '@/lib/notes';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string } },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const noteRoute = await import('@/lib/routes/notes/[id]/route');
const searchRoute = await import('@/app/api/search/route');

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const para = (text: string): DocsBlock => ({ id: crypto.randomUUID(), type: 'paragraph', content: text });

async function owner(): Promise<{ user: Awaited<ReturnType<typeof makeUser>>; o: NoteOwner }> {
  const user = await makeUser('nsync');
  return { user, o: { workspaceId: user.id, personId: user.id } };
}

beforeEach(() => {
  session.user = null;
  setNotesFtsOverride(null);
});

describe('notes: conflictos entre pestañas o dispositivos', () => {
  it('rechaza un guardado hecho sobre una versión vieja en vez de pisarla', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'Lista', content: [para('leche')] });
    // Teléfono: guarda sobre la versión que abrió.
    const phone = await updateNote(o, n.id, { content: [para('leche, pan')], base_updated_at: n.updated_at });
    expect(phone!.updated_at).not.toBe(n.updated_at);
    // Laptop con la pestaña vieja: misma base, ya no vale.
    await expect(updateNote(o, n.id, { content: [para('huevos')], base_updated_at: n.updated_at })).rejects.toBeInstanceOf(
      NotesConflictError,
    );
    expect((await getNote(o, n.id))!.content[0]).toMatchObject({ content: 'leche, pan' });
    // Con la base nueva entra.
    const ok = await updateNote(o, n.id, { content: [para('huevos')], base_updated_at: phone!.updated_at });
    expect(ok!.content[0]).toMatchObject({ content: 'huevos' });
  });

  it('dos guardados seguidos en el mismo milisegundo dejan marcas distintas', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'a' });
    const now = Date.parse(n.updated_at) + 5;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const first = await updateNote(o, n.id, { title: 'b', base_updated_at: n.updated_at });
      const second = await updateNote(o, n.id, { title: 'c', base_updated_at: first!.updated_at });
      expect(second!.updated_at > first!.updated_at).toBe(true);
      await expect(updateNote(o, n.id, { title: 'd', base_updated_at: first!.updated_at })).rejects.toBeInstanceOf(
        NotesConflictError,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('sin base sigue funcionando (clientes viejos, "conservar la mía")', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'x' });
    await updateNote(o, n.id, { title: 'y' });
    expect((await updateNote(o, n.id, { title: 'z' }))!.title).toBe('z');
  });

  it('la ruta responde 409 con la versión actual de la nota', async () => {
    const { user, o } = await owner();
    session.user = { id: user.id, email: user.email };
    const n = await createNote(o, { title: 'Doc', content: [para('uno')] });
    const first = await noteRoute.PATCH(
      jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { title: 'Doc', content: [para('dos')], base_updated_at: n.updated_at }),
      ctx(n.id),
    );
    expect(first.status).toBe(200);
    const stale = await noteRoute.PATCH(
      jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { title: 'Doc', content: [para('tres')], base_updated_at: n.updated_at }),
      ctx(n.id),
    );
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; note: { content: Array<{ content: string }> } };
    expect(body.error).toBe('conflict');
    expect(body.note.content[0].content).toBe('dos');
  });
});

describe('notes: la papelera es de solo lectura', () => {
  it('rechaza editar una nota en la papelera', async () => {
    const { o } = await owner();
    const n = await createNote(o, { title: 'Vieja', content: [para('texto')] });
    await trashNote(o, n.id);
    await expect(updateNote(o, n.id, { content: [para('nuevo')] })).rejects.toMatchObject({ code: 'note_trashed' });
    await expect(updateNote(o, n.id, { title: 'otro' })).rejects.toBeInstanceOf(NotesError);
    expect((await getNote(o, n.id))!.title).toBe('Vieja');
  });

  it('la ruta responde 409 note_trashed, y restaurar + editar en el mismo PATCH funciona', async () => {
    const { user, o } = await owner();
    session.user = { id: user.id, email: user.email };
    const n = await createNote(o, { title: 'T' });
    await trashNote(o, n.id);
    const res = await noteRoute.PATCH(jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { title: 'U' }), ctx(n.id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('note_trashed');
    const restored = await noteRoute.PATCH(
      jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { trashed: false, title: 'U' }),
      ctx(n.id),
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()) as { title: string; trashed: boolean }).toMatchObject({ title: 'U', trashed: false });
  });

  it('editar y mandar a la papelera en el mismo PATCH guarda la edición antes', async () => {
    const { user, o } = await owner();
    session.user = { id: user.id, email: user.email };
    const n = await createNote(o, { title: 'A' });
    const res = await noteRoute.PATCH(jsonReq(`http://x/api/notes/${n.id}`, 'PATCH', { trashed: true, title: 'B' }), ctx(n.id));
    expect(res.status).toBe(200);
    expect((await res.json()) as { title: string; trashed: boolean }).toMatchObject({ title: 'B', trashed: true });
  });
});

describe('búsqueda global (Cmd+K): notas', () => {
  it('incluye las notas propias y nunca las de otro miembro del workspace', async () => {
    const boss = await makeUser('srch-boss');
    const mate = await makeUser('srch-mate');
    const word = `zanahoria${crypto.randomUUID().slice(0, 6)}`;
    const mine = await createNote({ workspaceId: boss.id, personId: boss.id }, { title: `Receta ${word}` });
    const theirs = await createNote({ workspaceId: boss.id, personId: mate.id }, { title: `Secreto ${word}` });
    const trashed = await createNote({ workspaceId: boss.id, personId: boss.id }, { title: `Borrada ${word}` });
    await trashNote({ workspaceId: boss.id, personId: boss.id }, trashed.id);

    session.user = { id: boss.id, email: boss.email };
    const res = await searchRoute.GET(new NextRequest(`http://x/api/search?q=${word}`));
    const data = (await res.json()) as { items: Array<{ id: string; group: string; href: string }> };
    const notes = data.items.filter((i) => i.group === 'notes');
    expect(notes.map((i) => i.id)).toEqual([mine.id]);
    expect(notes[0].href).toBe(`/app/notes?note=${mine.id}`);

    // La compañera (actuando en el workspace del owner) ve solo la suya.
    const asMate = await searchNotesForPalette({ id: boss.id, actingUser: { id: mate.id } }, word);
    expect(asMate.map((n) => n.id)).toEqual([theirs.id]);
  });

  it('respeta el límite y funciona sin FTS', async () => {
    const { user, o } = await owner();
    const word = `pepino${crypto.randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 8; i++) await createNote(o, { title: `${word} ${i}` });
    setNotesFtsOverride(false);
    expect(await searchNotesForPalette(user, word)).toHaveLength(6);
    expect(await searchNotesForPalette(user, '   ')).toEqual([]);
  });
});
