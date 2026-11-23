/**
 * CRM, bloque C1: notas con formato (markdown saneado), comentarios en las
 * actividades del timeline y los restos de P5 (un solo filtro para la página,
 * "Seleccionar todos" y "Exportar la vista"; el orden y el tope del export).
 * Acceso: anónimo, otro workspace, miembro sin acceso, miembro con un campo
 * oculto y owner/admin. Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createActivity, createContact, createCustomField, deleteActivity, getActivity, updateActivity } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { listTrash, restoreTrash } from '@/lib/crm-trash';
import { listNotifications } from '@/lib/notifications';
import { activityBodyText, noteMarkdownToText, plainToMarkdown, sanitizeNoteMarkdown } from '@/lib/crm-note-format';
import { countComments, createComment, withCommentCounts } from '@/lib/crm-activity-comments';
import { listFilterModel } from '@/lib/crm-filter-http';
import { resolveMatching } from '@/lib/crm-list-matching';
import { buildRecordTimeline } from '@/lib/crm-timeline';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const commentsRoute = await import('@/lib/routes/crm/activities/[id]/comments/route');
const commentRoute = await import('@/lib/routes/crm/activities/[id]/comments/[commentId]/route');
const activitiesRoute = await import('@/app/api/crm/activities/route');
const exportRoute = await import('@/app/api/crm/export/route');
const mentionablesRoute = await import('@/app/api/crm/mentionables/route');

beforeEach(() => {
  session.user = null;
});

const uid = () => Math.random().toString(36).slice(2, 8);
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

function listComments(activityId: string) {
  return commentsRoute.GET(json(`http://test.local/api/crm/activities/${activityId}/comments`, 'GET'), { params: Promise.resolve({ id: activityId }) });
}
function postComment(activityId: string, body: string) {
  return commentsRoute.POST(json(`http://test.local/api/crm/activities/${activityId}/comments`, 'POST', { body }), {
    params: Promise.resolve({ id: activityId }),
  });
}
function patchComment(activityId: string, commentId: string, body: string) {
  return commentRoute.PATCH(json(`http://test.local/api/crm/activities/${activityId}/comments/${commentId}`, 'PATCH', { body }), {
    params: Promise.resolve({ id: activityId, commentId }),
  });
}
function deleteComment(activityId: string, commentId: string) {
  return commentRoute.DELETE(json(`http://test.local/api/crm/activities/${activityId}/comments/${commentId}`, 'DELETE'), {
    params: Promise.resolve({ id: activityId, commentId }),
  });
}

describe('note format (pure)', () => {
  it('keeps formatting and mentions, drops raw HTML and unsafe links', () => {
    const md = '**Bold** and _it_\n- one\n- two\n[site](https://example.test) @ana@example.test';
    expect(sanitizeNoteMarkdown(md)).toBe(md);
    expect(sanitizeNoteMarkdown('hi <img src=x onerror=alert(1)><script>bad()</script>')).toBe('hi bad()');
    expect(sanitizeNoteMarkdown('<<b>script>x')).not.toMatch(/<\s*script/i);
    expect(sanitizeNoteMarkdown('[click](javascript:alert(1))')).not.toMatch(/javascript:/i);
    expect(sanitizeNoteMarkdown('[a](javascript:void)')).toBe('a');
    expect(sanitizeNoteMarkdown('[a](data:text/html,x)')).toBe('a');
    expect(sanitizeNoteMarkdown('[ref]: javascript:alert(1)\n\ntext')).toBe('text');
    expect(sanitizeNoteMarkdown('<https://example.test> and <!-- hidden -->ok')).toBe('<https://example.test> and ok');
    expect(sanitizeNoteMarkdown('a\u0000b\r\nc')).toBe('ab\nc');
    // Texto con < y > que no es una etiqueta queda tal cual.
    expect(sanitizeNoteMarkdown('if n<10 and m>2, x <y z>')).toBe('if n<10 and m>2, x <y z>');
    expect(sanitizeNoteMarkdown('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('turns markdown into plain text and plain text into markdown that reads the same', () => {
    expect(noteMarkdownToText('# Title\n**bold** _it_ ~~gone~~ `code` [link](https://x.test)\n- [ ] task')).toBe('Title\nbold it gone code link\n- task');
    expect(activityBodyText({ body: '**x**', body_format: 'md' })).toBe('x');
    expect(activityBodyText({ body: '**x**', body_format: 'text' })).toBe('**x**');
    expect(plainToMarkdown('2 * 3 = 6\n# not a title\n- not a list\nmail ana_b@example.test _x_')).toBe(
      '2 \\* 3 = 6\n\\# not a title\n\\- not a list\nmail ana_b@example.test \\_x\\_',
    );
  });
});

describe('formatted notes', () => {
  it('stores markdown only for notes, sanitized, and old plain notes stay plain', async () => {
    const w = await workspaceWithMember('c1-fmt');
    const c = await createContact(w.owner.id, { firstName: 'Fmt', lastName: uid() });
    const rich = await createActivity(w.owner.id, { type: 'note', body: '**Hi** <b>x</b>', bodyFormat: 'md', contactId: c.id });
    expect(rich.body_format).toBe('md');
    expect(rich.body).toBe('**Hi** x');
    const plain = await createActivity(w.owner.id, { type: 'note', body: 'plain *text*', contactId: c.id });
    expect(plain.body_format).toBe('text');
    // Una tarea nunca queda con formato.
    const task = await createActivity(w.owner.id, { type: 'task', subject: 'T', body: '**b**', bodyFormat: 'md', contactId: c.id });
    expect(task.body_format).toBe('text');
    // Editar una nota de antes con el editor la pasa a markdown; cambiarla de tipo la vuelve a texto plano.
    const edited = await updateActivity(w.owner.id, plain.id, { body: plainToMarkdown(plain.body) + ' **more**', bodyFormat: 'md' });
    expect(edited?.body_format).toBe('md');
    // Pasar a formato sin cuerpo nuevo escapa el texto de antes (se sigue leyendo igual).
    const other = await createActivity(w.owner.id, { type: 'note', body: '* not a list', contactId: c.id });
    expect((await updateActivity(w.owner.id, other.id, { bodyFormat: 'md' }))?.body).toBe('\\* not a list');
    const asCall = await updateActivity(w.owner.id, rich.id, { type: 'call' });
    expect(asCall?.body_format).toBe('text');
    expect(asCall?.body).toBe('Hi x');
  });

  it('POST /api/crm/activities accepts bodyFormat and notifies @email mentions only to who can see the record', async () => {
    const w = await workspaceWithMember('c1-post');
    await setMemberVisibility(w.owner.id, 'mine');
    const c = await createContact(w.owner.id, { firstName: 'Post', lastName: uid(), ownerId: w.friend.id });
    session.user = asOwner(w.owner);
    const res = await activitiesRoute.POST(
      json('http://test.local/api/crm/activities', 'POST', {
        type: 'note',
        body: `Ping @${w.friend.email} and @${w.member.email}`,
        bodyFormat: 'md',
        contactId: c.id,
      }),
    );
    expect(res.status).toBe(201);
    // Texto plano: el tope de siempre (5000); con formato, hasta 20000.
    const long = (body: string, bodyFormat?: string) =>
      activitiesRoute.POST(json('http://test.local/api/crm/activities', 'POST', { type: 'note', body, bodyFormat, contactId: c.id }));
    expect((await long('x'.repeat(5001))).status).toBe(400);
    expect((await long('x'.repeat(5001), 'md')).status).toBe(201);
    const out = (await res.json()) as { body_format: string; mentions_not_notified?: Array<{ id: string }> };
    expect(out.body_format).toBe('md');
    expect(out.mentions_not_notified?.map((m) => m.id)).toEqual([w.member.id]);
    expect((await listNotifications(w.friend.id)).length).toBe(1);
    expect(await listNotifications(w.member.id)).toHaveLength(0);
  });

  it('mentionables: anonymous 401, a teammate gets the team (id, name, email only)', async () => {
    const w = await workspaceWithMember('c1-people');
    expect((await mentionablesRoute.GET()).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    const people = ((await (await mentionablesRoute.GET()).json()) as { people: Array<Record<string, unknown>> }).people;
    expect(people.map((p) => p.id).sort()).toEqual([w.owner.id, w.member.id, w.friend.id].sort());
    expect(Object.keys(people[0]).sort()).toEqual(['email', 'id', 'name']);
    session.user = asOwner(w.stranger);
    const other = ((await (await mentionablesRoute.GET()).json()) as { people: Array<{ id: string }> }).people;
    expect(other.map((p) => p.id)).not.toContain(w.member.id);
  });
});

describe('comments on activities: access', () => {
  it('anonymous 401, other workspace 404, teammate and owner read and post', async () => {
    const w = await workspaceWithMember('c1-acc');
    const c = await createContact(w.owner.id, { firstName: 'Acc', lastName: uid() });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq c1 note', contactId: c.id });
    await createComment(w.owner.id, note.id, w.owner.id, 'zq first comment');
    const expected = { anonymous: 401, other_workspace: 404, teammate: 200, owner: 200 } as const;
    for (const r of roles(w)) {
      session.user = r.user;
      const res = await listComments(note.id);
      expect(res.status, r.name).toBe(expected[r.name]);
      const text = await res.text();
      if (r.name === 'anonymous' || r.name === 'other_workspace') expect(text).not.toContain('zq first comment');
      const posted = await postComment(note.id, `hello from ${r.name}`);
      expect(posted.status, `post ${r.name}`).toBe(expected[r.name] === 200 ? 201 : expected[r.name]);
    }
    expect((await countComments(w.owner.id, [note.id])).get(note.id)).toBe(3);
  });

  it('a member who cannot see the activity can neither read nor post, and the count does not leak', async () => {
    const w = await workspaceWithMember('c1-hidden');
    await setMemberVisibility(w.owner.id, 'mine');
    const c = await createContact(w.owner.id, { firstName: 'Hidden', lastName: uid(), ownerId: w.owner.id });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq hidden', contactId: c.id });
    await createComment(w.owner.id, note.id, w.owner.id, 'zq secret comment');
    session.user = asMember(w.owner, w.member);
    const res = await listComments(note.id);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('zq secret comment');
    expect((await postComment(note.id, 'sneaky')).status).toBe(404);
    const [only] = await getDb().prepare('SELECT id FROM crm_activity_comments WHERE activity_id = ?').all(note.id);
    expect(only).toBeTruthy();
    expect((await countComments(w.owner.id, [note.id])).get(note.id)).toBe(1);
    // Un id de comentario ajeno tampoco sirve por la otra ruta.
    const cid = (only as { id: string }).id;
    expect((await patchComment(note.id, cid, 'x')).status).toBe(404);
    expect((await deleteComment(note.id, cid)).status).toBe(404);
  });

  it('a member with a hidden field still comments on the record activity, and the thread carries no record fields', async () => {
    const w = await workspaceWithMember('c1-field');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'margin', label: 'Margin', type: 'number' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    const c = await createContact(w.owner.id, { firstName: 'Field', lastName: uid() });
    await getDb().prepare("UPDATE crm_contacts SET custom = json_set(custom, '$.margin', 4242) WHERE id = ?").run(c.id);
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq field note', contactId: c.id });
    session.user = asMember(w.owner, w.member);
    expect((await postComment(note.id, 'member comment')).status).toBe(201);
    const res = await listComments(note.id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('member comment');
    expect(text).not.toContain('4242');
    expect(text).not.toContain('margin');
  });

  it('owner, admin and member edit or delete only their own comments; markdown is sanitized', async () => {
    const w = await workspaceWithMember('c1-own');
    const c = await createContact(w.owner.id, { firstName: 'Own', lastName: uid() });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq own', contactId: c.id });
    session.user = asMember(w.owner, w.member);
    const mine = (await (await postComment(note.id, '**mine** <img src=x onerror=alert(1)>')).json()) as { id: string; body: string };
    expect(mine.body).toBe('**mine**');
    expect((await postComment(note.id, '   ')).status).toBe(400);
    expect((await postComment(note.id, '<b></b>')).status).toBe(400);

    // Ni el owner ni un admin editan o borran el comentario de otra persona.
    for (const user of [asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      session.user = user;
      expect((await patchComment(note.id, mine.id, 'hijack')).status).toBe(403);
      expect((await deleteComment(note.id, mine.id)).status).toBe(403);
    }
    session.user = asMember(w.owner, w.member);
    const edited = (await (await patchComment(note.id, mine.id, 'edited [x](javascript:alert(1))')).json()) as { body: string; edited: number };
    expect(edited.edited).toBe(1);
    expect(edited.body).toMatch(/^edited /);
    expect(edited.body).not.toMatch(/javascript:/i);
    // El comentario va con su actividad: con otro id de actividad no existe.
    const other = await createActivity(w.owner.id, { type: 'note', body: 'other', contactId: c.id });
    expect((await patchComment(other.id, mine.id, 'moved')).status).toBe(404);
    expect((await deleteComment(note.id, mine.id)).status).toBe(204);
    expect((await countComments(w.owner.id, [note.id])).get(note.id)).toBeUndefined();
  });

  it('comment mentions notify only teammates who can see the activity', async () => {
    const w = await workspaceWithMember('c1-mention');
    await setMemberVisibility(w.owner.id, 'mine');
    const c = await createContact(w.owner.id, { firstName: 'Ment', lastName: uid(), ownerId: w.friend.id });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq mention', contactId: c.id });
    session.user = asOwner(w.owner);
    const res = await postComment(note.id, `@${w.friend.email} and @${w.member.email} look`);
    expect(res.status).toBe(201);
    const out = (await res.json()) as { id: string; mentions_not_notified?: Array<{ id: string }> };
    expect(out.mentions_not_notified?.map((m) => m.id)).toEqual([w.member.id]);
    const friendNotes = await listNotifications(w.friend.id);
    expect(friendNotes).toHaveLength(1);
    expect(friendNotes[0].title).toContain('comment');
    expect(await listNotifications(w.member.id)).toHaveLength(0);
    // Editar sin sumar menciones no vuelve a avisar.
    await patchComment(note.id, out.id, `@${w.friend.email} and @${w.member.email} look again`);
    expect(await listNotifications(w.friend.id)).toHaveLength(1);
  });

  it('the thread goes to the trash with its activity and comes back with it', async () => {
    const w = await workspaceWithMember('c1-trash');
    const c = await createContact(w.owner.id, { firstName: 'Trash', lastName: uid() });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq trash', contactId: c.id });
    await createComment(w.owner.id, note.id, w.owner.id, 'keep me');
    expect(await deleteActivity(w.owner.id, note.id)).toBe(true);
    expect((await countComments(w.owner.id, [note.id])).size).toBe(0);
    const entry = (await listTrash(w.owner.id)).find((t) => t.record_id === note.id);
    expect(entry).toBeTruthy();
    await restoreTrash(w.owner.id, entry!.id);
    expect(await getActivity(w.owner.id, note.id)).toBeTruthy();
    expect((await countComments(w.owner.id, [note.id])).get(note.id)).toBe(1);
  });

  it('the record timeline carries comment counts, and never for an email thread whose activity the member cannot see', async () => {
    const w = await workspaceWithMember('c1-count');
    const c = await createContact(w.owner.id, { firstName: 'Count', lastName: uid() });
    const note = await createActivity(w.owner.id, { type: 'note', body: 'zq count', contactId: c.id });
    await createComment(w.owner.id, note.id, w.owner.id, 'one');
    await createComment(w.owner.id, note.id, w.member.id, 'two');
    const page = await buildRecordTimeline(asOwner(w.owner), { kind: 'contact', id: c.id }, { ownerScope: null, chatReader: null });
    const item = page.items.find((i) => i.id === note.id) as { comment_count?: number; comment_activity_id?: string };
    expect(item.comment_count).toBe(2);
    expect(item.comment_activity_id).toBe(note.id);
    // Un thread de email cuya actividad nombra algo fuera del alcance: sin hilo ni cantidad.
    const hidden = await createActivity(w.owner.id, { type: 'email', body: 'x', contactId: c.id });
    const items = await withCommentCounts(
      w.owner.id,
      [{ id: 'thread-1', external: true, thread: { activityId: hidden.id } }, { id: 'wa-1', external: true }],
      [],
    );
    expect(items.every((i) => !('comment_count' in i))).toBe(true);
  });
});

describe('P5 leftovers: one filter for the page, select all and export view', () => {
  it('rules the page drops are dropped by select all too (no invalid_filter), the rest still filter', async () => {
    const w = await workspaceWithMember('c1-filters');
    const tag = uid();
    const a = await createContact(w.owner.id, { firstName: 'Ann', lastName: tag, city: 'Lima' });
    await createContact(w.owner.id, { firstName: 'Bob', lastName: tag, city: 'Quito' });
    const model = { v: 1, groups: [{ rules: [{ f: 'city', o: 'equals', v: ['Lima'] }, { f: 'gone_property', o: 'known' }, { f: 'custom:nope', o: 'known' }] }] };
    const env = { viewerId: w.owner.id, timeZone: 'UTC', strictCustom: true as const };
    expect(listFilterModel(JSON.stringify(model), 'contacts', { customTypes: {}, env })).toEqual({
      v: 1,
      groups: [{ rules: [{ f: 'city', o: 'equals', v: ['Lima'] }] }],
    });
    const res = await resolveMatching(asOwner(w.owner), 'contacts', `q=${tag}&filters=${encodeURIComponent(JSON.stringify(model))}`, 100);
    expect('ids' in res && res.ids).toEqual([a.id]);
  });

  it('export view keeps the view sort and says how many rows the view has', async () => {
    const w = await workspaceWithMember('c1-export');
    const tag = uid();
    const z = await createContact(w.owner.id, { firstName: 'Zed', lastName: tag });
    const a = await createContact(w.owner.id, { firstName: 'Abe', lastName: tag });
    const m = await createContact(w.owner.id, { firstName: 'Max', lastName: tag });
    session.user = asOwner(w.owner);
    const res = await exportRoute.GET(
      new NextRequest(`http://test.local/api/crm/export?entity=contacts&format=json&list=${encodeURIComponent(`q=${tag}&sort=name`)}`),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([a.id, m.id, z.id]);
    expect(res.headers.get('x-export-total')).toBe('3');
    expect(res.headers.get('x-export-count')).toBe('3');
    expect(res.headers.get('x-export-cap')).toBe('10000');
    // Sin vista (export filtrado de siempre), sin esos encabezados.
    const plain = await exportRoute.GET(new NextRequest('http://test.local/api/crm/export?entity=contacts&format=json'));
    expect(plain.headers.get('x-export-total')).toBeNull();
  });
});
