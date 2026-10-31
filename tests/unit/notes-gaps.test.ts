import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDb } from '@/lib/db';
import { createNote, getNote, listNotes, noteOwner, updateNote, type NoteOwner } from '@/lib/notes';
import { emailBlocks, getNotesEmail, parseEmailSubject, parseNotesAddress, processNotesInbound } from '@/lib/notes-email';
import { extractArticle, extractPage, htmlToClipBlocks } from '@/lib/notes-clip';
import { cleanHomeWidgets, DEFAULT_HOME_WIDGETS, moveHomeWidget } from '@/lib/notes-home';
import { groupTasks, type NoteTask } from '@/lib/notes-tasks-shared';
import { fireNoteTasksDue, listTasks, setTaskChecked, setTaskMeta } from '@/lib/notes-tasks';
import { decideAccessRequest, listAccessRequests, noteAccessGate, requestNoteAccess } from '@/lib/notes-access';
import { getNoteForViewer, setNoteShare } from '@/lib/notes-shares';
import { fileTextKind, joinBody, pdfText, syncNoteFileQueue } from '@/lib/notes-file-text';
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
    const email = { emailId: `e-${Date.now()}`, from: 'Ana <ana@cliente.test>', subject: 'Recibo #gastos', text: 'Total 10', headers: {}, attachments: [] };
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
    expect(await setTaskMeta(owner, note.id, 'nope', { due: '2026-03-01' })).toBe('not_found');
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
    await db.prepare("INSERT INTO note_file_text (note_id, block_id, kind, status, text) VALUES (?, 'p', 'pdf', 'done', 'palabraescaneada')").run(note.id);
    const saved = await updateNote(owner, note.id, { content: [{ id: 'p', type: 'paragraph', content: 'hola de nuevo' }] });
    expect(saved).toBeTruthy();
    expect((await listNotes(owner, { q: 'palabraescaneada' })).map((n) => n.id)).toEqual([note.id]);
  });
});

describe('consola de admin', () => {
  it('cuenta por persona, apaga links y pasa notas', async () => {
    const { owner, asA, asB, ownerUser } = await workspace('adm');
    const note = await createNote(asA, { title: 'De A', content: [] });
    await getDb().prepare("UPDATE notes SET share_token = 'tok-adm' WHERE id = ?").run(note.id);
    await setNoteShare(asA, { kind: 'note', id: note.id }, asB.personId, 'view');
    const view = await notesAdminOverview(ownerUser.id);
    expect(view.members.find((m) => m.id === asA.personId)).toMatchObject({ notes: 1, public_links: 1, shares: 1 });
    expect(view.links.map((l) => l.note_id)).toEqual([note.id]);
    expect(await adminDisableLink('otro-ws', note.id)).toBe(false);
    expect(await adminDisableLink(ownerUser.id, note.id)).toBe(true);
    expect((await notesAdminOverview(ownerUser.id)).links).toEqual([]);
    expect(await adminTransferNotes(ownerUser.id, asA.personId, 'fuera')).toBe('not_member');
    expect(await adminTransferNotes(ownerUser.id, asA.personId, asB.personId)).toBe(1);
    expect((await listNotes(asB)).map((n) => n.id)).toEqual([note.id]);
    expect(await listNotes(asA)).toEqual([]);
    expect(await getNote(owner, note.id)).toBeNull();
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
