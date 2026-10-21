import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createNote, createNotebook, getNote, listNotes, noteOwner, trashNote, type NoteOwner } from '@/lib/notes';
import {
  getNoteForViewer,
  listNoteShares,
  listSharedWithMe,
  resolveNoteAccess,
  setNoteShare,
  sharedPatchAllowed,
  strongestRole,
} from '@/lib/notes-shares';
import { hasIssueLink, issueLinkHtml, linkTodos, noteIssueDescription, todoIssueTitle, sendNoteToTrack } from '@/lib/notes-track';
import { databaseHeader, type DocsBlock } from '@/lib/docs-types';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { docsBlockSchema } from '@/lib/docs-schema';
import { blocksToMarkdown } from '@/lib/docs-markdown';
import { filterQuery, emptyKind } from '@/components/notes/notes-ui';
import { createProject, getIssue } from '@/lib/track-data';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; actingUser?: { id: string }; team?: { id: string } | null },
}));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const noteRoute = await import('@/app/api/notes/[id]/route');
const notesRoute = await import('@/app/api/notes/route');
const sharesRoute = await import('@/app/api/notes/[id]/shares/route');
const trackRoute = await import('@/app/api/notes/[id]/track/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

async function workspace(label: string) {
  const owner = await makeUser(`${label}o`);
  const a = await makeUser(`${label}a`);
  const b = await makeUser(`${label}b`);
  const team = await createTeam(owner.id, `T ${label}`);
  await addMember(team.id, a.id, 'member');
  await addMember(team.id, b.id, 'member');
  const person = (p: { id: string }): NoteOwner => ({ workspaceId: owner.id, personId: p.id });
  const sessionFor = (p: { id: string; email: string }) => ({
    id: owner.id,
    email: owner.email,
    actingUser: p.id === owner.id ? undefined : { id: p.id },
    team: { id: team.id },
  });
  return { owner, a, b, team, person, sessionFor };
}

const para = (content: string): DocsBlock => ({ id: crypto.randomUUID(), type: 'paragraph', content });
const todo = (content: string, checked = false): DocsBlock => ({ id: crypto.randomUUID(), type: 'todo', content, checked });

beforeEach(() => {
  session.user = null;
});

describe('notes-shares: reglas puras', () => {
  it('el rol más fuerte gana y quien edita solo toca título y contenido', () => {
    expect(strongestRole(['view', 'edit'])).toBe('edit');
    expect(strongestRole(['view'])).toBe('view');
    expect(strongestRole([])).toBeNull();
    expect(sharedPatchAllowed({ title: 'x', content: [], base_updated_at: 'y' })).toBe(true);
    expect(sharedPatchAllowed({ title: 'x', tags: ['a'] })).toBe(false);
    expect(sharedPatchAllowed({ pinned: undefined, title: 'x' })).toBe(true);
  });

  it('el filtro "Compartidas conmigo" pide view=shared', () => {
    expect(filterQuery({ kind: 'shared' }, '', 'updated')).toBe('view=shared&sort=updated');
    expect(emptyKind({ kind: 'shared' }, '')).toBe('shared');
  });
});

describe('notes-shares: compartir una nota', () => {
  it('ver y editar según el rol, sin filtrar datos del dueño', async () => {
    const ws = await workspace('ns');
    const other = await createNote(ws.person(ws.a), { title: 'Secreta' });
    const note = await createNote(ws.person(ws.a), {
      title: 'Plan',
      content: [para(`Ver <a data-page="${other.id}">otra</a>`)],
      tags: ['privado'],
    });
    expect(await resolveNoteAccess(ws.person(ws.b), note.id)).toBeNull();

    expect(await setNoteShare(ws.person(ws.a), { kind: 'note', id: note.id }, ws.b.id, 'view')).toBe('ok');
    const seen = await getNoteForViewer(ws.person(ws.b), note.id);
    expect(seen).toMatchObject({ access: 'view', title: 'Plan', backlinks: [], share_token: null });
    // El dueño ve el título actual de la nota linkeada; quien la recibe, no.
    expect(JSON.stringify((await getNote(ws.person(ws.a), note.id))?.content)).toContain('Secreta');
    expect(JSON.stringify(seen?.content)).not.toContain('Secreta');
    expect((await listSharedWithMe(ws.person(ws.b))).map((n) => [n.id, n.access])).toEqual([[note.id, 'view']]);
    // No aparece en las listas propias de quien la recibe.
    expect((await listNotes(ws.person(ws.b))).map((n) => n.id)).not.toContain(note.id);

    session.user = ws.sessionFor(ws.b);
    const denied = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { title: 'Cambio' }), ctx(note.id));
    expect(denied.status).toBe(403);

    await setNoteShare(ws.person(ws.a), { kind: 'note', id: note.id }, ws.b.id, 'edit');
    const ok = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { title: 'Plan v2', content: [para('Nuevo')] }), ctx(note.id));
    expect(ok.status).toBe(200);
    expect((await getNote(ws.person(ws.a), note.id))?.title).toBe('Plan v2');
    const tagsDenied = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { tags: ['x'] }), ctx(note.id));
    expect(tagsDenied.status).toBe(403);
    const trashDenied = await noteRoute.PATCH(jsonReq('http://x', 'PATCH', { trashed: true }), ctx(note.id));
    expect(trashDenied.status).toBe(403);
    const shared = await (await notesRoute.GET(new NextRequest('http://x/api/notes?view=shared'))).json();
    expect(shared.notes.map((n: { id: string }) => n.id)).toEqual([note.id]);

    // Las personas con acceso solo las ve y cambia el dueño.
    const sharesDenied = await sharesRoute.GET(jsonReq('http://x', 'GET'), ctx(note.id));
    expect(sharesDenied.status).toBe(404);
    session.user = ws.sessionFor(ws.a);
    const list = await (await sharesRoute.GET(jsonReq('http://x', 'GET'), ctx(note.id))).json();
    expect(list.shares.map((s: { person_id: string; role: string }) => [s.person_id, s.role])).toEqual([[ws.b.id, 'edit']]);
    expect(list.candidates.map((c: { id: string }) => c.id)).not.toContain(ws.a.id);

    // En la papelera deja de verse; sacar el share corta el acceso.
    await trashNote(ws.person(ws.a), note.id);
    expect(await resolveNoteAccess(ws.person(ws.b), note.id)).toBeNull();
    const removed = await sharesRoute.PATCH(jsonReq('http://x', 'PATCH', { personId: ws.b.id, role: null }), ctx(note.id));
    expect(removed.status).toBe(200);
    expect(await listNoteShares(ws.person(ws.a), { kind: 'note', id: note.id })).toEqual([]);
  });

  it('una libreta compartida incluye sus notas, también las nuevas', async () => {
    const ws = await workspace('nb');
    const nb = await createNotebook(ws.person(ws.a), 'Equipo');
    const n1 = await createNote(ws.person(ws.a), { title: 'Uno', notebook_id: nb.id });
    await createNote(ws.person(ws.a), { title: 'Fuera' });
    expect(await setNoteShare(ws.person(ws.a), { kind: 'notebook', id: nb.id }, ws.b.id, 'view')).toBe('ok');
    const n2 = await createNote(ws.person(ws.a), { title: 'Dos', notebook_id: nb.id });
    const list = await listSharedWithMe(ws.person(ws.b));
    expect(list.map((n) => n.title).sort()).toEqual(['Dos', 'Uno']);
    expect(list.every((n) => n.shared_by)).toBe(true);
    expect((await resolveNoteAccess(ws.person(ws.b), n1.id))?.access).toBe('view');
    // Share directo con más rol gana.
    await setNoteShare(ws.person(ws.a), { kind: 'note', id: n2.id }, ws.b.id, 'edit');
    expect((await resolveNoteAccess(ws.person(ws.b), n2.id))?.access).toBe('edit');
    expect((await listSharedWithMe(ws.person(ws.b), { q: 'dos' })).map((n) => n.title)).toEqual(['Dos']);
  });

  it('no se comparte con gente de afuera ni con uno mismo, ni libretas ajenas', async () => {
    const ws = await workspace('nx');
    const note = await createNote(ws.person(ws.a), { title: 'X' });
    const stranger = await makeUser('nxs');
    expect(await setNoteShare(ws.person(ws.a), { kind: 'note', id: note.id }, stranger.id, 'view')).toBe('not_member');
    expect(await setNoteShare(ws.person(ws.a), { kind: 'note', id: note.id }, ws.a.id, 'view')).toBe('not_member');
    expect(await setNoteShare(ws.person(ws.b), { kind: 'note', id: note.id }, ws.owner.id, 'view')).toBe('not_found');
  });
});

describe('notes-track: nota o tareas → issues con link de vuelta', () => {
  it('helpers puros', () => {
    expect(todoIssueTitle('Comprar <strong>pan</strong> &amp; leche')).toBe('Comprar pan & leche');
    const link = issueLinkHtml({ id: 'i1', identifier: 'ABC-1' });
    expect(link).toBe('<a href="/app/track/issues/i1">ABC-1</a>');
    expect(hasIssueLink(`Hacer algo ${link}`)).toBe(true);
    expect(hasIssueLink('<a href="https://x.com" target="_blank">x</a>')).toBe(false);
    const blocks = [todo('Uno'), todo('Dos ')];
    const linked = linkTodos(blocks, new Map([[blocks[1].id, { id: 'i2', identifier: 'ABC-2' }]]));
    expect(linked[0]).toBe(blocks[0]);
    expect(linked[1].content).toBe('Dos <a href="/app/track/issues/i2">ABC-2</a>');
    expect(noteIssueDescription('', 'n1', 'Plan [v2]', 'Desde la nota')).toBe('Desde la nota: [Plan v2](/app/notes?note=n1)');
  });

  it('tareas elegidas: un issue cada una, la nota queda con los links y no se duplica', async () => {
    const ws = await workspace('nt');
    const project = await createProject(ws.owner.id, ws.team.id, { name: 'Ops', color: '#5e6ad2' });
    const t1 = todo('Llamar al proveedor');
    const t2 = todo('Revisar contrato', true);
    const note = await createNote(ws.person(ws.a), { title: 'Semana', content: [para('Intro'), t1, t2] });
    const res = await sendNoteToTrack({
      owner: ws.person(ws.a),
      teamId: ws.team.id,
      personId: ws.a.id,
      noteId: note.id,
      projectId: project.id,
      blockIds: [t1.id, t2.id],
      baseUpdatedAt: note.updated_at,
      fromLabel: 'From note',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.issues.map((i) => i.title)).toEqual(['Llamar al proveedor', 'Revisar contrato']);
    const issue = await getIssue(res.issues[0].id);
    expect(issue?.description).toContain(`/app/notes?note=${note.id}`);
    const after = await getNote(ws.person(ws.a), note.id);
    const contents = after!.content.filter((b) => b.type === 'todo').map((b) => b.content);
    expect(contents.every((c) => hasIssueLink(c))).toBe(true);
    // Otra vez con las mismas tareas: no hay nada nuevo para mandar.
    const again = await sendNoteToTrack({
      owner: ws.person(ws.a),
      teamId: ws.team.id,
      personId: ws.a.id,
      noteId: note.id,
      projectId: project.id,
      blockIds: [t1.id],
    });
    expect(again).toEqual({ ok: false, code: 'nothing_to_send' });
  });

  it('la nota entera: un issue con el texto y un párrafo con el link; base vieja = conflicto', async () => {
    const ws = await workspace('nw');
    const project = await createProject(ws.owner.id, ws.team.id, { name: 'Docs', color: '#5e6ad2' });
    const note = await createNote(ws.person(ws.a), { title: 'Idea grande', content: [para('Detalle de la idea')] });
    const stale = await sendNoteToTrack({
      owner: ws.person(ws.a),
      teamId: ws.team.id,
      personId: ws.a.id,
      noteId: note.id,
      projectId: project.id,
      baseUpdatedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(stale).toEqual({ ok: false, code: 'conflict' });

    // Por la ruta, quien solo puede ver no manda nada.
    await setNoteShare(ws.person(ws.a), { kind: 'note', id: note.id }, ws.b.id, 'view');
    session.user = ws.sessionFor(ws.b);
    const denied = await trackRoute.POST(jsonReq('http://x', 'POST', { projectId: project.id }), ctx(note.id));
    expect(denied.status).toBe(403);

    session.user = ws.sessionFor(ws.a);
    const res = await trackRoute.POST(jsonReq('http://x', 'POST', { projectId: project.id, locale: 'es' }), ctx(note.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { issues: Array<{ id: string; title: string }> };
    expect(body.issues[0].title).toBe('Idea grande');
    const issue = await getIssue(body.issues[0].id);
    expect(issue?.description).toContain('Detalle de la idea');
    expect(issue?.description).toContain('Desde la nota');
    const after = await getNote(ws.person(ws.a), note.id);
    expect(hasIssueLink(after!.content[after!.content.length - 1].content)).toBe(true);
  });
});

describe('docs: bloque /board y encabezados de bases', () => {
  it('el bloque board pasa el schema y solo guarda un id válido', () => {
    expect(docsBlockSchema.safeParse({ id: 'b', type: 'board', content: '', board_id: 'abc-123' }).success).toBe(true);
    const [ok, bad, other] = sanitizeBlocks([
      { id: '1', type: 'board', content: '', board_id: 'abc-123' },
      { id: '2', type: 'board', content: '', board_id: '../x?y' },
      { id: '3', type: 'paragraph', content: 'x', board_id: 'abc' },
    ]);
    expect(ok.board_id).toBe('abc-123');
    expect(bad.board_id).toBeUndefined();
    expect(other.board_id).toBeUndefined();
    expect(blocksToMarkdown([ok])).toBe('[Board](/app/board/abc-123)\n');
  });

  it('databaseHeader: nombres de columnas de una base (no de una tabla)', () => {
    expect(
      databaseHeader({ type: 'database', columns: [{ id: 'a', name: 'Nombre', type: 'text' }, { id: 'b', name: 'Estado', type: 'select' }] }),
    ).toEqual(['Nombre', 'Estado']);
    expect(databaseHeader({ type: 'database', columns: [] })).toBeNull();
    expect(databaseHeader({ type: 'table' })).toBeNull();
  });

  it('noteOwner sigue siendo workspace + persona', () => {
    expect(noteOwner({ id: 'w', actingUser: { id: 'p' } })).toEqual({ workspaceId: 'w', personId: 'p' });
  });
});
