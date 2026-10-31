import { beforeAll, describe, expect, it } from 'vitest';
import { recordAiUsage } from '@/lib/ai';
import { saveUpload } from '@/lib/uploads';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDb } from '@/lib/db';
import { createNote, createNotebook, getNote, listNotebooks, listNotes, noteOwner, updateNote, type NoteOwner } from '@/lib/notes';
import { emailBlocks, getNotesEmail, parseEmailSubject, parseNotesAddress, processNotesInbound } from '@/lib/notes-email';
import { extractArticle, extractPage, htmlToClipBlocks } from '@/lib/notes-clip';
import { cleanHomeWidgets, DEFAULT_HOME_WIDGETS, moveHomeWidget } from '@/lib/notes-home';
import { groupTasks, type NoteTask } from '@/lib/notes-tasks-shared';
import { fireNoteTasksDue, listTasks, setTaskChecked, setTaskMeta } from '@/lib/notes-tasks';
import { decideAccessRequest, listAccessRequests, noteAccessGate, requestNoteAccess } from '@/lib/notes-access';
import { getNoteForViewer, setNoteShare } from '@/lib/notes-shares';
import { fileTextKind, joinBody, looksLikeRefusal, noteFileFailures, pdfText, processNoteFileQueue, retryNoteFileFailures, setNoteOcrEnabled, setNoteOcrOverride, syncNoteFileQueue } from '@/lib/notes-file-text';
import { getNotePrefs, saveNotePrefs } from '@/lib/notes-prefs';
import { adminDisableLink, adminTransferNotes, notesAdminOverview } from '@/lib/notes-admin';
import { handleNotesRpc } from '@/lib/notes-mcp';
import { detectQuad } from '@/lib/notes-scan';
import { addMember, createTeam } from '@/lib/teams';
import { createEventType } from '@/lib/calendar';
import { listNoteEvents, noteFromEvent } from '@/lib/notes-events';
import { makeUser } from './helpers';

async function workspace(label: string) {
  const ownerUser = await makeUser(`${label}o`);
  const a = await makeUser(`${label}a`);
  const b = await makeUser(`${label}b`);
  const team = await createTeam(ownerUser.id, label);
  await addMember(team.id, a.id, 'member');
  await addMember(team.id, b.id, 'member');
  const owner: NoteOwner = noteOwner(ownerUser);
  const asA: NoteOwner = { workspaceId: ownerUser.id, personId: a.id };
  const asB: NoteOwner = { workspaceId: ownerUser.id, personId: b.id };
  return { owner, asA, asB, a, b, ownerUser };
}

const todo = (id: string, content: string, checked = false) => ({ id, type: 'todo' as const, content, checked });
const task = (over: Partial<NoteTask>): NoteTask => ({ note_id: 'n', note_title: '', block_id: Math.random().toString(), text: 't', checked: false, due: null, assignee_id: null, assignee_name: null, mine: true, ...over });

describe('email a nota', () => {
  it('separa título, libreta y etiquetas del final del asunto', () => {
    expect(parseEmailSubject('Fwd: Factura de luz @Finanzas #recibos #2026')).toEqual({ title: 'Factura de luz', notebook: 'Finanzas', tags: ['recibos', '2026'] });
    expect(parseEmailSubject('Hablar con @juan del #tema mañana')).toEqual({ title: 'Hablar con @juan del #tema mañana', notebook: null, tags: [] });
  });
  it('solo acepta el dominio de entrada propio', () => {
    const token = 'a'.repeat(24);
    expect(parseNotesAddress([`Notas <notes+${token}@in.zerosoft.test>`], 'in.zerosoft.test')).toBe(token);
    expect(parseNotesAddress([`notes+${token}@otro.test`], 'in.zerosoft.test')).toBeNull();
    expect(parseNotesAddress([`notes+corto@in.zerosoft.test`], 'in.zerosoft.test')).toBeNull();
  });
  it('escapa el HTML del email', () => {
    const blocks = emailBlocks('a@b.c', '<script>alert(1)</script>\n\nhola');
    expect(blocks[1].content).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('crea la nota una sola vez por email, en la libreta del asunto', async () => {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    const { owner } = await workspace('mail');
    const { address } = await getNotesEmail(owner);
    const token = parseNotesAddress([address!], 'in.zerosoft.test')!;
    const email = { emailId: `e-${Date.now()}`, from: 'Ana <ana@cliente.test>', subject: 'Recibo #gastos', text: 'Total 10', headers: {}, attachments: [], authentication: null };
    const first = await processNotesInbound(token, email);
    expect(first.status).toBe('created');
    expect((await processNotesInbound(token, email))).toEqual({ status: 'skipped', reason: 'duplicate' });
    const notes = await listNotes(owner, { tag: 'gastos' });
    expect(notes.map((n) => n.title)).toEqual(['Recibo']);
    // Una dirección regenerada deja de valer.
    await getNotesEmail(owner, { rotate: true });
    expect(await processNotesInbound(token, { ...email, emailId: `${email.emailId}-2` })).toEqual({ status: 'skipped', reason: 'unknown_address' });
    expect((await processNotesInbound('z'.repeat(24), { ...email, emailId: `${email.emailId}-3` })).status).toBe('skipped');
  });
});

describe('recortes', () => {
  const html = `<html><head><title>x</title><style>.a{}</style></head><body>
    <nav><a href="/menu">Menu</a></nav>
    <article><h1>Titular</h1><p>${'Texto largo. '.repeat(30)}<a href="/rel">link</a></p>
      <ul><li>uno</li><li>dos</li></ul><img src="/foto.png" alt="foto"><pre>code()</pre><script>alert(1)</script></article>
    <footer>pie</footer></body></html>`;
  it('el artículo deja afuera menú y pie; la página entera no', () => {
    expect(extractArticle(html)).not.toContain('Menu');
    expect(extractArticle(html)).not.toContain('pie');
    expect(extractPage(html)).toContain('Menu');
    expect(extractPage(html)).not.toContain('alert(1)');
  });
  it('arma bloques con links absolutos e imágenes para bajar', () => {
    const blocks = htmlToClipBlocks(extractArticle(html), 'https://ej.test/nota');
    expect(blocks.find((b) => b.type === 'heading')?.content).toBe('Titular');
    expect(blocks.filter((b) => b.type === 'bulleted_list_item')).toHaveLength(2);
    expect(blocks.find((b) => b.type === 'code')?.content).toBe('code()');
    expect(blocks.find((b) => b.type === 'image')?.clipImage).toBe('https://ej.test/foto.png');
    expect(blocks.some((b) => b.content.includes('https://ej.test/rel'))).toBe(true);
  });
  it('no deja pasar marcado peligroso', () => {
    const blocks = htmlToClipBlocks('<p onclick="x()">hola <a href="javascript:alert(1)">mal</a><img src="javascript:alert(2)"></p>', 'https://ej.test/');
    const all = JSON.stringify(blocks);
    expect(all).not.toContain('javascript:');
    expect(all).not.toContain('onclick');
  });
});

describe('inicio', () => {
  it('limpia widgets desconocidos y repetidos', () => {
    expect(cleanHomeWidgets(['tasks', 'x', 'tasks', 'scratch'])).toEqual(['tasks', 'scratch']);
    expect(cleanHomeWidgets('nope')).toEqual([...DEFAULT_HOME_WIDGETS]);
    expect(cleanHomeWidgets([])).toEqual([]);
  });
  it('mueve dentro de la lista', () => {
    expect(moveHomeWidget(['tasks', 'scratch'], 'scratch', -1)).toEqual(['scratch', 'tasks']);
    expect(moveHomeWidget(['tasks', 'scratch'], 'tasks', -1)).toEqual(['tasks', 'scratch']);
  });
  it('guarda por persona', async () => {
    const { owner, asA } = await workspace('prefs');
    await saveNotePrefs(owner, { home: ['tags'], scratch: 'hola' });
    expect(await getNotePrefs(owner)).toEqual({ home: ['tags'], scratch: 'hola' });
    expect((await getNotePrefs(asA)).scratch).toBe('');
  });
});

describe('tareas', () => {
  it('agrupa por vencimiento', () => {
    const g = groupTasks(
      [task({ due: '2026-01-01' }), task({ due: '2026-01-05' }), task({ due: '2026-02-01' }), task({}), task({ checked: true, due: '2020-01-01' })],
      '2026-01-05',
    );
    expect([g.overdue.length, g.today.length, g.upcoming.length, g.noDate.length, g.done.length]).toEqual([1, 1, 1, 1, 1]);
  });
  it('asignar comparte la nota, la lista la ve quien la recibió y el check vuelve al contenido', async () => {
    const { owner, asA, asB } = await workspace('task');
    const note = await createNote(owner, { title: 'Plan', content: [todo('t1', 'Llamar'), todo('t2', 'Mandar')] });
    expect(await setTaskMeta(asA, note.id, 't1', { due: '2026-03-01' })).toBe('not_found');
    // Un todo sin guardar todavía: se acepta y no aparece hasta que exista.
    expect(await setTaskMeta(owner, note.id, 'sin-guardar', { due: '2026-03-01' })).toMatchObject({ due: '2026-03-01' });
    const meta = await setTaskMeta(owner, note.id, 't1', { due: '2026-03-01', assignee_id: asA.personId });
    expect(meta).toMatchObject({ due: '2026-03-01', assignee_id: asA.personId });
    const mine = await listTasks(asA);
    expect(mine.map((t) => [t.block_id, t.mine])).toEqual([['t1', false]]);
    expect((await listTasks(owner)).length).toBe(2);
    expect(await listTasks(asB)).toEqual([]);
    expect(await setTaskChecked(asA, note.id, 't1', true)).toMatchObject({ updated_at: expect.any(String) });
    expect((await getNote(owner, note.id))!.content.find((b) => b.id === 't1')?.checked).toBe(true);
    expect(await setTaskChecked(asB, note.id, 't1', false)).toBe('not_found');
  });
  it('avisa una vez lo vencido y no lo hecho', async () => {
    const { owner } = await workspace('due');
    const note = await createNote(owner, { title: 'Avisos', content: [todo('a', 'abierta'), todo('b', 'hecha', true)] });
    await setTaskMeta(owner, note.id, 'a', { due: '2020-01-01' });
    await setTaskMeta(owner, note.id, 'b', { due: '2020-01-01' });
    const now = new Date('2026-01-01T00:00:00Z');
    expect(await fireNoteTasksDue({ now })).toBeGreaterThanOrEqual(1);
    const rows = (await getDb().prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'note_task'").get(owner.personId)) as { c: number };
    expect(Number(rows.c)).toBe(1);
    await fireNoteTasksDue({ now });
    const again = (await getDb().prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'note_task'").get(owner.personId)) as { c: number };
    expect(Number(again.c)).toBe(1);
  });
});

describe('pedir acceso', () => {
  it('no filtra nada, avisa al dueño y aprobar da el rol', async () => {
    const { owner, asA } = await workspace('req');
    const other = await makeUser('reqx');
    const note = await createNote(owner, { title: 'Secreto', content: [] });
    expect(await noteAccessGate(owner, note.id)).toBeNull();
    expect(await noteAccessGate({ workspaceId: other.id, personId: other.id }, note.id)).toBeNull();
    expect(await requestNoteAccess({ workspaceId: other.id, personId: other.id }, note.id)).toBe(false);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'can_request' });
    expect(await getNoteForViewer(asA, note.id)).toBeNull();
    expect(await requestNoteAccess(asA, note.id)).toBe(true);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'pending' });
    expect(await listAccessRequests(asA, note.id)).toBeNull();
    const [r] = (await listAccessRequests(owner, note.id))!;
    expect(await decideAccessRequest(asA, note.id, r.id, 'edit')).toBe('not_found');
    expect(await decideAccessRequest(owner, note.id, r.id, 'view')).toBe('ok');
    expect(await decideAccessRequest(owner, note.id, r.id, 'edit')).toBe('not_found');
    expect((await getNoteForViewer(asA, note.id))?.access).toBe('view');
    expect(await noteAccessGate(asA, note.id)).toBeNull();
  });
  it('rechazar deja pedir de nuevo', async () => {
    const { owner, asA } = await workspace('rej');
    const note = await createNote(owner, { title: 'N', content: [] });
    await requestNoteAccess(asA, note.id);
    const [r] = (await listAccessRequests(owner, note.id))!;
    await decideAccessRequest(owner, note.id, r.id, null);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'denied_wait' });
    // Recién rechazado no vuelve a avisar.
    await requestNoteAccess(asA, note.id);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'denied_wait' });
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await getDb().prepare('UPDATE note_access_requests SET decided_at = ? WHERE id = ?').run(old, r.id);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'denied' });
    await requestNoteAccess(asA, note.id);
    expect(await noteAccessGate(asA, note.id)).toEqual({ status: 'pending' });
  });
});

describe('texto de archivos', () => {
  it('elige imágenes y PDF con URL', () => {
    expect(fileTextKind({ type: 'image', url: 'u' })).toBe('image');
    expect(fileTextKind({ type: 'pdf', url: 'u' })).toBe('pdf');
    expect(fileTextKind({ type: 'file', url: 'u', mime: 'application/pdf' })).toBe('pdf');
    expect(fileTextKind({ type: 'file', url: 'u', mime: 'text/plain' })).toBeNull();
    expect(fileTextKind({ type: 'image' })).toBeNull();
    expect(joinBody('a', ['', ' b '])).toBe('a\nb');
  });
  it('lee la capa de texto de un PDF', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([400, 400]).drawText('quarterly invoice zebra', { x: 20, y: 300, font, size: 14 });
    expect(await pdfText(await pdf.save())).toContain('quarterly invoice zebra');
  });
  it('la cola sigue a los bloques y el texto leído entra a la búsqueda sin tocar updated_at', async () => {
    const { owner } = await workspace('ocr');
    const note = await createNote(owner, { title: 'Escaneo', content: [{ id: 'p', type: 'paragraph', content: 'hola' }] });
    await syncNoteFileQueue(note.id, [{ id: 'img', type: 'image', content: '', url: '/u/x.png' }]);
    const db = getDb();
    expect(((await db.prepare('SELECT block_id FROM note_file_text WHERE note_id = ?').all(note.id)) as Array<{ block_id: string }>).map((r) => r.block_id)).toEqual(['img']);
    await syncNoteFileQueue(note.id, []);
    expect((await db.prepare('SELECT block_id FROM note_file_text WHERE note_id = ?').all(note.id)).length).toBe(0);
    await db.prepare("INSERT INTO note_file_text (note_id, block_id, workspace_id, kind, status, text) VALUES (?, 'p', ?, 'pdf', 'done', 'palabraescaneada')").run(note.id, owner.workspaceId);
    const saved = await updateNote(owner, note.id, { content: [{ id: 'p', type: 'paragraph', content: 'hola de nuevo' }] });
    expect(saved).toBeTruthy();
    expect((await listNotes(owner, { q: 'palabraescaneada' })).map((n) => n.id)).toEqual([note.id]);
  });
});

describe('consola de admin', () => {
  async function leave(ws: Awaited<ReturnType<typeof workspace>>, personId: string) {
    await getDb().prepare('DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE owner_id = ?)').run(personId, ws.ownerUser.id);
  }
  it('cuenta por persona y apaga links, con registro', async () => {
    const ws = await workspace('adm');
    const { asA, asB, ownerUser } = ws;
    const note = await createNote(asA, { title: 'De A', content: [] });
    await getDb().prepare("UPDATE notes SET share_token = 'tok-adm' WHERE id = ?").run(note.id);
    await setNoteShare(asA, { kind: 'note', id: note.id }, asB.personId, 'view');
    const view = await notesAdminOverview(ownerUser.id);
    expect(view.members.find((m) => m.id === asA.personId)).toMatchObject({ notes: 1, public_links: 1, shares: 1 });
    expect(await adminDisableLink('otro-ws', ownerUser.id, note.id)).toBe(false);
    expect(await adminDisableLink(ownerUser.id, ownerUser.id, note.id)).toBe(true);
    const after = await notesAdminOverview(ownerUser.id);
    expect(after.links).toEqual([]);
    expect(after.audit.map((a) => a.action)).toEqual(['disable_link']);
  });
  it('no deja llevarse notas de alguien activo, del dueño ni hacia uno mismo', async () => {
    const ws = await workspace('adm2');
    const { asA, asB, ownerUser } = ws;
    await createNote(asA, { title: 'Privada', content: [] });
    await createNote(ws.owner, { title: 'Del dueño', content: [] });
    expect(await adminTransferNotes(ownerUser.id, asB.personId, asA.personId, ownerUser.id)).toBe('not_former');
    expect(await adminTransferNotes(ownerUser.id, asB.personId, ownerUser.id, asA.personId)).toBe('owner');
    await leave(ws, asA.personId);
    expect(await adminTransferNotes(ownerUser.id, asB.personId, asA.personId, asB.personId)).toBe('self');
    expect(await adminTransferNotes(ownerUser.id, asB.personId, asA.personId, 'fuera')).toBe('not_member');
    expect((await listNotes(asA)).length).toBe(1);
    expect((await notesAdminOverview(ownerUser.id)).audit).toEqual([]);
  });
  it('de quien se fue: mantiene los compartidos, une libretas iguales y queda registrado', async () => {
    const ws = await workspace('adm3');
    const { asA, asB, owner, ownerUser } = ws;
    const third = await makeUser('adm3c');
    const team = (await getDb().prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerUser.id)) as { id: string };
    await addMember(team.id, third.id, 'member');
    const asC: NoteOwner = { workspaceId: ownerUser.id, personId: third.id };
    const bookA = await createNotebook(asA, 'Clientes');
    const bookB = await createNotebook(asB, 'clientes');
    const only = await createNotebook(asA, 'Solo A');
    const n1 = await createNote(asA, { title: 'En libreta', notebook_id: bookA.id, content: [] });
    const n2 = await createNote(asA, { title: 'Suelta', notebook_id: only.id, content: [] });
    await setNoteShare(asA, { kind: 'note', id: n2.id }, asC.personId, 'edit');
    await setNoteShare(asA, { kind: 'notebook', id: bookA.id }, asC.personId, 'view');
    await leave(ws, asA.personId);
    expect((await notesAdminOverview(ownerUser.id)).former.map((f) => f.id)).toEqual([asA.personId]);
    expect(await adminTransferNotes(ownerUser.id, owner.personId, asA.personId, asB.personId)).toBe(2);
    expect((await getNote(asB, n1.id))?.notebook_id).toBe(bookB.id);
    expect((await getNoteForViewer(asC, n2.id))?.access).toBe('edit');
    expect((await getNoteForViewer(asC, n1.id))?.access).toBe('view');
    const books = await listNotebooks(asB);
    expect(books.map((b) => b.name).sort()).toEqual(['Solo A', 'clientes']);
    const overview = await notesAdminOverview(ownerUser.id);
    expect(overview.former).toEqual([]);
    expect(overview.audit[0]).toMatchObject({ action: 'transfer', detail: { from: asA.personId, to: asB.personId, notes: 2 } });
  });
});

describe('tareas tras sacar un share', () => {
  it('sacar el share limpia la asignación y corta la lista y el aviso', async () => {
    const { owner, asA } = await workspace('rev');
    const note = await createNote(owner, { title: 'Plan', content: [todo('t1', 'Llamar')] });
    await setTaskMeta(owner, note.id, 't1', { due: '2020-01-01', assignee_id: asA.personId });
    expect((await listTasks(asA)).length).toBe(1);
    await setNoteShare(owner, { kind: 'note', id: note.id }, asA.personId, null);
    expect(await listTasks(asA)).toEqual([]);
    const row = (await getDb().prepare('SELECT assignee_id FROM note_tasks WHERE note_id = ?').get(note.id)) as { assignee_id: string | null };
    expect(row.assignee_id).toBeNull();
  });
  it('una asignación vieja sin acceso no lista ni avisa a esa persona: avisa al dueño', async () => {
    const { owner, asA } = await workspace('rev2');
    const note = await createNote(owner, { title: 'Plan', content: [todo('t1', 'Llamar')] });
    await getDb().prepare("INSERT INTO note_tasks (note_id, block_id, due_date, assignee_id) VALUES (?, 't1', '2020-01-01', ?)").run(note.id, asA.personId);
    expect(await listTasks(asA)).toEqual([]);
    await fireNoteTasksDue({ now: new Date('2026-01-01T00:00:00Z') });
    const count = async (id: string) => Number(((await getDb().prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'note_task'").get(id)) as { c: number }).c);
    expect(await count(asA.personId)).toBe(0);
    expect(await count(owner.personId)).toBe(1);
  });
  it('tampoco sobre una nota en la papelera', async () => {
    const { owner } = await workspace('rev3');
    const note = await createNote(owner, { title: 'Plan', content: [todo('t1', 'Llamar')] });
    await getDb().prepare("UPDATE notes SET trashed_at = '2026-01-01' WHERE id = ?").run(note.id);
    expect(await setTaskChecked(owner, note.id, 't1', true)).toBe('not_found');
  });
});

describe('email: acceso y autenticación', () => {
  const base = (id: string) => ({ emailId: id, from: 'Ana <ana@cliente.test>', subject: 'Recibo', text: 'x', headers: {}, attachments: [], authentication: null });
  async function address(owner: NoteOwner) {
    process.env.CHAT_INBOUND_DOMAIN = 'in.zerosoft.test';
    return parseNotesAddress([(await getNotesEmail(owner)).address!], 'in.zerosoft.test')!;
  }
  it('quien se fue ya no crea notas', async () => {
    const { asA, ownerUser } = await workspace('mail2');
    const token = await address(asA);
    await getDb().prepare('DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE owner_id = ?)').run(asA.personId, ownerUser.id);
    expect(await processNotesInbound(token, base(`g-${Date.now()}`))).toEqual({ status: 'skipped', reason: 'no_access' });
  });
  it('sin acceso a Notes tampoco', async () => {
    const { asA, ownerUser } = await workspace('mail3');
    const token = await address(asA);
    await getDb().prepare(`UPDATE team_members SET apps = '["crm"]' WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE owner_id = ?)`).run(asA.personId, ownerUser.id);
    expect(await processNotesInbound(token, base(`h-${Date.now()}`))).toEqual({ status: 'skipped', reason: 'no_access' });
  });
  it('un remitente que no pasa la autenticación no entra', async () => {
    const { owner } = await workspace('mail4');
    const token = await address(owner);
    const res = await processNotesInbound(token, { ...base(`i-${Date.now()}`), authentication: { dmarc: 'fail', spf: 'fail', dkim: 'fail' } as never });
    expect(res).toEqual({ status: 'skipped', reason: 'auth_failed' });
    expect(await listNotes(owner)).toEqual([]);
  });
  it('los adjuntos que no entran quedan dichos en la nota', async () => {
    const { owner } = await workspace('mail5');
    const token = await address(owner);
    const res = await processNotesInbound(token, { ...base(`j-${Date.now()}`), skippedNote: 'Attachments not saved: 1 (too_large)', attachments: [{ filename: 'x.exe', contentType: 'application/x-msdownload', data: Buffer.from('x') }] });
    expect(res.status).toBe('created');
    const note = await getNote(owner, (res as { noteId: string }).noteId);
    expect(JSON.stringify(note?.content)).toContain('too_large');
  });
});

describe('cola de archivos', () => {
  const pending = async (ws: string) =>
    (await getDb().prepare("SELECT block_id, status, attempts, kind FROM note_file_text WHERE workspace_id = ? ORDER BY block_id").all(ws)) as Array<{ block_id: string; status: string; attempts: number; kind: string }>;
  let fileUrl = '';
  const image = (id: string) => ({ id, type: 'image' as const, content: '', url: fileUrl, name: 'f.png', size: 8, mime: 'image/png' });
  beforeAll(async () => {
    fileUrl = await saveUpload('docs', 'f.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
  const clean = () => getDb().prepare('DELETE FROM note_file_text').run();

  it('sin prender el OCR una foto queda afuera, y prenderlo no lee lo anterior', async () => {
    await clean();
    const { owner } = await workspace('ocr1');
    const note = await createNote(owner, { title: 'F', content: [image('a')] });
    expect((await pending(owner.workspaceId))[0].status).toBe('off');
    await setNoteOcrEnabled(owner.workspaceId, true);
    await updateNote(owner, note.id, { content: [image('a'), image('b')] });
    expect((await pending(owner.workspaceId)).map((r) => [r.block_id, r.status])).toEqual([['a', 'off'], ['b', 'pending']]);
  });
  it('reparte entre workspaces: uno lleno no acapara la pasada', async () => {
    await clean();
    const seen: string[] = [];
    setNoteOcrOverride(async (ws) => {
      seen.push(ws);
      return 'texto';
    });
    const big = await workspace('ocr2');
    const small = await workspace('ocr3');
    await setNoteOcrEnabled(big.owner.workspaceId, true);
    await setNoteOcrEnabled(small.owner.workspaceId, true);
    const a = await createNote(big.owner, { title: 'Big', content: [image('a1'), image('a2'), image('a3')] });
    const b = await createNote(small.owner, { title: 'Small', content: [image('b1')] });
    const db = getDb();
    await db.prepare("UPDATE note_file_text SET queued_at = '2020-01-01' WHERE note_id = ?").run(a.id);
    await db.prepare("UPDATE note_file_text SET queued_at = '2025-01-01' WHERE note_id = ?").run(b.id);
    // La de big es mucho más vieja y tiene 3 filas: igual le toca a small en la misma pasada.
    const res = await processNoteFileQueue({ limit: 2 });
    expect(res.done).toBe(2);
    expect(seen).toEqual([big.owner.workspaceId, small.owner.workspaceId]);
    expect((await listNotes(small.owner, { q: 'texto' })).map((n) => n.id)).toEqual([b.id]);
    setNoteOcrOverride(null);
  });
  it('sin cuota se saltea sin bajar el archivo ni gastar intentos', async () => {
    await clean();
    const calls: string[] = [];
    setNoteOcrOverride(async (ws) => {
      calls.push(ws);
      return 'x';
    });
    const prev = process.env.AI_FREE_TOKENS_PER_MONTH;
    process.env.AI_FREE_TOKENS_PER_MONTH = '1';
    try {
      const { owner } = await workspace('ocr6');
      await setNoteOcrEnabled(owner.workspaceId, true);
      await createNote(owner, { title: 'F', content: [image('q')] });
      await recordAiUsage({ workspaceId: owner.workspaceId, feature: 'test', model: 'm', inputTokens: 100, outputTokens: 0 });
      const res = await processNoteFileQueue({});
      expect(res).toEqual({ done: 0, failed: 0, skipped: 1 });
      expect(calls).toEqual([]);
      expect((await pending(owner.workspaceId))[0]).toMatchObject({ status: 'pending', attempts: 0 });
    } finally {
      if (prev === undefined) delete process.env.AI_FREE_TOKENS_PER_MONTH;
      else process.env.AI_FREE_TOKENS_PER_MONTH = prev;
      setNoteOcrOverride(null);
    }
  });
  it('si el modelo se disculpa, falla y no entra a la búsqueda', async () => {
    await clean();
    setNoteOcrOverride(async () => "I'm sorry, I can't see any image.");
    const { owner } = await workspace('ocr7');
    await setNoteOcrEnabled(owner.workspaceId, true);
    const note = await createNote(owner, { title: 'F', content: [image('r')] });
    await processNoteFileQueue({});
    setNoteOcrOverride(null);
    expect(await noteFileFailures(note.id)).toEqual(['r']);
    expect(await listNotes(owner, { q: 'sorry' })).toEqual([]);
  });
  it('un tope de tiempo vencido no procesa nada', async () => {
    await clean();
    const { owner } = await workspace('ocr4');
    await setNoteOcrEnabled(owner.workspaceId, true);
    await createNote(owner, { title: 'F', content: [image('z')] });
    await new Promise((r) => setTimeout(r, 2));
    const res = await processNoteFileQueue({ budgetMs: -1 });
    expect(res).toEqual({ done: 0, failed: 0, skipped: 0 });
    expect((await pending(owner.workspaceId))[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });
  it('una fila colgada sin intentos que gastar falla y se puede reintentar', async () => {
    await clean();
    const { owner } = await workspace('ocr5');
    await setNoteOcrEnabled(owner.workspaceId, true);
    const note = await createNote(owner, { title: 'F', content: [image('s')] });
    await getDb().prepare("UPDATE note_file_text SET status = 'processing', attempts = 3, claimed_at = '2020-01-01' WHERE note_id = ?").run(note.id);
    await processNoteFileQueue({});
    expect((await pending(owner.workspaceId))[0].status).toBe('failed');
    expect(await noteFileFailures(note.id)).toEqual(['s']);
    await retryNoteFileFailures(note.id);
    expect((await pending(owner.workspaceId))[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await noteFileFailures(note.id)).toEqual([]);
  });
  it('una disculpa del modelo no es texto', () => {
    expect(looksLikeRefusal("I'm sorry, I can't see any image.")).toBe(true);
    expect(looksLikeRefusal('Lo siento, no puedo ver la imagen')).toBe(true);
    expect(looksLikeRefusal('Não consigo ler o arquivo')).toBe(true);
    expect(looksLikeRefusal('Total 42 USD, factura 0001')).toBe(false);
  });
});

describe('MCP de Notes', () => {
  it('respeta los scopes y lee y crea notas de la persona', async () => {
    const { owner, asA } = await workspace('mcp');
    await createNote(asA, { title: 'Ajena', content: [] });
    const read = { owner, scopes: ['notes:read' as const] };
    const tools = (await handleNotesRpc(read, { id: 1, method: 'tools/list' }))!.result as { tools: Array<{ name: string }> };
    expect(tools.tools.map((t) => t.name)).not.toContain('create_note');
    const denied = (await handleNotesRpc(read, { id: 2, method: 'tools/call', params: { name: 'create_note', arguments: { title: 'x' } } }))!.result as { isError: boolean };
    expect(denied.isError).toBe(true);
    const write = { owner, scopes: ['notes:write' as const] };
    await handleNotesRpc(write, { id: 3, method: 'tools/call', params: { name: 'create_note', arguments: { title: 'Por MCP', markdown: '- [ ] tarea' } } });
    const found = (await handleNotesRpc(read, { id: 4, method: 'tools/call', params: { name: 'search_notes', arguments: {} } }))!.result as { content: Array<{ text: string }> };
    const titles = (JSON.parse(found.content[0].text) as { notes: Array<{ title: string }> }).notes.map((n) => n.title);
    expect(titles).toEqual(['Por MCP']);
    expect((await listTasks(owner)).map((t) => t.text)).toEqual(['tarea']);
    expect(await handleNotesRpc(read, { method: 'notifications/initialized' })).toBeNull();
  });
});

describe('escaneo', () => {
  it('encuentra las esquinas de una hoja clara sobre fondo oscuro', () => {
    const w = 200;
    const h = 150;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= 40 && x < 160 && y >= 30 && y < 120;
        const v = inside ? 240 : 40;
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const quad = detectQuad({ width: w, height: h, data })!;
    expect(quad[0].x).toBeCloseTo(40, -1);
    expect(quad[0].y).toBeCloseTo(30, -1);
    expect(quad[2].x).toBeCloseTo(159, -1);
    expect(quad[2].y).toBeCloseTo(119, -1);
  });
  it('sin hoja no inventa bordes', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    expect(detectQuad({ width: 100, height: 100, data })).toBeNull();
  });
});

describe('nota desde una reserva de Cal', () => {
  it('lista las reservas de la persona y arma la nota', async () => {
    const { owner, asA, ownerUser } = await workspace('cal');
    const et = await createEventType(ownerUser.id, { slug: `n-${crypto.randomUUID().slice(0, 6)}`, title: 'Demo', durationMin: 30, active: true } as Parameters<typeof createEventType>[1]);
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const id = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO calendar_bookings (id, event_type_id, invitee_email, invitee_name, starts_at, ends_at) VALUES (?, ?, 'ana@x.test', 'Ana', ?, ?)")
      .run(id, et.id, start, start);
    expect((await listNoteEvents(owner)).map((e) => [e.id, e.attendee])).toEqual([[id, 'Ana']]);
    expect(await listNoteEvents(asA)).toEqual([]);
    const labels = { when: 'When', with: 'With', agenda: 'Agenda', notes: 'Notes', actions: 'Actions' };
    expect(await noteFromEvent(asA, id, labels, 'en', 'UTC')).toBeNull();
    const note = await noteFromEvent(owner, id, labels, 'en', 'UTC');
    expect(note?.title).toBe('Demo: Ana');
    expect(note?.tags).toEqual(['meeting']);
  });
});
