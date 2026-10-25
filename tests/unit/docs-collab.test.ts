import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createDocComment, createDocPage, createDocShare, getDocAccess, getDocPageRow, listDocPageSummaries, parseBlocks, updateDocPage } from '@/lib/docs';
import { getDocVersion, listDocVersions } from '@/lib/docs-versions';
import {
  createTeamspace,
  getDocsSettings,
  hiddenTeamspaceIds,
  setTeamspaceMember,
  updateDocsSettings,
} from '@/lib/docs-access';
import { acceptGuestInvite, createGuestInvite, listPageInvites } from '@/lib/docs-guests';
import { auditToCsv, listDocsAudit, logDocsAudit } from '@/lib/docs-audit';
import { fireVerificationExpiry, verifyDocPage } from '@/lib/docs-verify';
import { applySuggestEdit, wrapComment } from '@/lib/docs-marks';
import { addMember, createTeam } from '@/lib/teams';
import type { DocsBlock } from '@/lib/docs-types';
import { makeUser } from './helpers';

type FakeUser = { id: string; email: string; name?: string | null; actingUser?: { id: string; email: string; name?: string | null }; role?: string; team?: { id: string } | null };
const session = vi.hoisted(() => ({ user: null as null | FakeUser }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: FakeUser) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: FakeUser) => !u.actingUser || u.role === 'owner' || u.role === 'admin',
}));
vi.mock('@/lib/user-tz', () => ({ getUserTimeZone: async () => 'UTC' }));

const pageRoute = await import('@/app/api/docs/pages/[id]/route');
const shareRoute = await import('@/app/api/docs/pages/[id]/share/route');
const liveRoute = await import('@/app/api/docs/pages/[id]/live/route');
const exportRoute = await import('@/app/api/docs/pages/[id]/export/route');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function req(url: string, method: string, body?: unknown) {
  const r = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // NextRequest: cookies y nextUrl.
  return Object.assign(r, {
    cookies: { get: () => undefined },
    nextUrl: new URL(url),
  }) as never;
}
const para = (id: string, content: string): DocsBlock => ({ id, type: 'paragraph', content });

/** Un workspace (team) con dueño y un miembro que actúa en él. */
async function workspace() {
  const owner = await makeUser('own');
  const member = await makeUser('mem');
  const team = await createTeam(owner.id, 'Equipo');
  await addMember(team.id, member.id, 'member');
  const asMember: FakeUser = { id: owner.id, email: owner.email, actingUser: { id: member.id, email: member.email, name: member.name }, role: 'member', team };
  const asOwner: FakeUser = { id: owner.id, email: owner.email, name: owner.name };
  return { owner, member, team, asMember, asOwner };
}

beforeEach(() => {
  session.user = null;
});

describe('Docs D3: roles de los miembros (solo lectura)', () => {
  it('por defecto el miembro tiene acceso total; con "puede ver" queda en lectura', async () => {
    const { owner, asMember } = await workspace();
    const page = await createDocPage(owner.id, { title: 'Wiki', content: [para('a', 'hola')] });
    const row = (await getDocPageRow(page.id))!;
    expect(await getDocAccess(row, asMember as never)).toBe('owner');
    await updateDocsSettings(owner.id, { member_role: 'view' });
    expect((await getDocsSettings(owner.id)).member_role).toBe('view');
    expect(await getDocAccess(row, asMember as never)).toBe('view');
    // El dueño y los admins siguen con acceso total.
    expect(await getDocAccess(row, { id: owner.id } as never)).toBe('owner');
    // Un PATCH de contenido de un miembro de solo lectura: 403.
    session.user = asMember;
    const res = await pageRoute.PATCH(req(`http://x/api/docs/pages/${page.id}`, 'PATCH', { content: [para('a', 'chau')] }), ctx(page.id));
    expect(res.status).toBe(403);
  });

  it('una página puede fijar su propio rol para los miembros (y lo heredan las subpáginas)', async () => {
    const { owner, asMember } = await workspace();
    const parent = await createDocPage(owner.id, { title: 'Padre' });
    const child = await createDocPage(owner.id, { title: 'Hija', parent_id: parent.id });
    await updateDocPage(owner.id, parent.id, { member_role: 'comment' });
    expect(await getDocAccess((await getDocPageRow(child.id))!, asMember as never)).toBe('comment');
    await updateDocPage(owner.id, child.id, { member_role: 'edit' });
    expect(await getDocAccess((await getDocPageRow(child.id))!, asMember as never)).toBe('edit');
  });
});

describe('Docs D3: "puede comentar" y sugerencias', () => {
  it('quien comenta solo guarda resaltados y sus sugerencias', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Doc', content: [para('a', 'Hola mundo')] });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'comment');
    session.user = { id: guest.id, email: guest.email };
    const base = (await getDocPageRow(page.id))!.updated_at;
    const url = `http://x/api/docs/pages/${page.id}`;
    // Editar de verdad: no.
    let res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'Hola gente')], base_updated_at: base }), ctx(page.id));
    expect(res.status).toBe(403);
    // Sugerir: sí, y avisa al dueño.
    const sug = applySuggestEdit('Hola mundo', 'Hola lindo mundo', guest.id, () => 'sug1');
    // Como lo manda el editor: con título, ícono y portada sin cambios.
    res = await pageRoute.PATCH(
      req(url, 'PATCH', { title: 'Doc', icon: null, cover_url: '', content: [para('a', sug.html)], base_updated_at: base }),
      ctx(page.id),
    );
    expect(res.status).toBe(200);
    const notes = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND title LIKE '%suggested%'").all(owner.id)) as Array<{ title: string }>;
    expect(notes.length).toBe(1);
    // Comentar sobre texto: el resaltado entra.
    const after = (await getDocPageRow(page.id))!;
    const content = JSON.parse(after.content) as DocsBlock[];
    const marked = wrapComment(content[0].content, 0, 4, 'c1');
    res = await pageRoute.PATCH(req(url, 'PATCH', { content: [{ ...content[0], content: marked }], base_updated_at: after.updated_at }), ctx(page.id));
    expect(res.status).toBe(200);
    // Ni título ni otros campos.
    res = await pageRoute.PATCH(req(url, 'PATCH', { title: 'Otro' }), ctx(page.id));
    expect(res.status).toBe(403);
  });
});

describe('Docs D3: bloquear página', () => {
  it('bloqueada no se edita (423) pero se comenta sobre el texto; desbloquear vuelve a permitir', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Política', content: [para('a', 'No tocar')] });
    session.user = { id: owner.id, email: owner.email };
    const url = `http://x/api/docs/pages/${page.id}`;
    expect((await pageRoute.PATCH(req(url, 'PATCH', { locked: true }), ctx(page.id))).status).toBe(200);
    let row = (await getDocPageRow(page.id))!;
    expect(row.locked).toBe(1);
    expect(row.locked_by).toBe(owner.id);
    let res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'Tocado')], base_updated_at: row.updated_at }), ctx(page.id));
    expect(res.status).toBe(423);
    res = await pageRoute.PATCH(req(url, 'PATCH', { title: 'Nuevo' }), ctx(page.id));
    expect(res.status).toBe(423);
    // Un resaltado de comentario sí.
    res = await pageRoute.PATCH(
      req(url, 'PATCH', { title: 'Política', icon: null, cover_url: '', content: [para('a', wrapComment('No tocar', 0, 2, 'c9'))], base_updated_at: row.updated_at }),
      ctx(page.id),
    );
    expect(res.status).toBe(200);
    // Una sugerencia no (bloqueada no se sugiere).
    row = (await getDocPageRow(page.id))!;
    const sug = applySuggestEdit(JSON.parse(row.content)[0].content, 'No tocarX', owner.id, () => 's2');
    res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', sug.html)], base_updated_at: row.updated_at }), ctx(page.id));
    expect(res.status).toBe(423);
    expect((await pageRoute.PATCH(req(url, 'PATCH', { locked: false }), ctx(page.id))).status).toBe(200);
    row = (await getDocPageRow(page.id))!;
    res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'Ahora sí')], base_updated_at: row.updated_at }), ctx(page.id));
    expect(res.status).toBe(200);
    const audit = await listDocsAudit(owner.id, { pageId: page.id });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['page.locked', 'page.unlocked']));
  });
});

describe('Docs: un solo mecanismo de fusión (servidor contra la revisión base)', () => {
  it('guardar sobre una versión vieja se fusiona en el servidor; sin la revisión base, 409 con la versión actual', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Acta', content: [para('a', 'uno')] });
    session.user = { id: owner.id, email: owner.email };
    const url = `http://x/api/docs/pages/${page.id}`;
    const base = page.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    expect((await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'uno dos')], base_updated_at: base }), ctx(page.id))).status).toBe(200);
    // Otra persona editó otra parte de la misma frase sobre la misma base: quedan las dos.
    let res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'cero uno')], base_updated_at: base }), ctx(page.id));
    expect(res.status).toBe(200);
    const merged = (await res.json()) as { content: DocsBlock[]; merged: boolean; updated_at: string };
    expect(merged.merged).toBe(true);
    expect(merged.content[0].content).toBe('cero uno dos');
    // Una base que ya no está entre las revisiones: el editor recibe la actual para fusionar y reintentar.
    await new Promise((r) => setTimeout(r, 5));
    res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'x')], base_updated_at: '2000-01-01T00:00:00.000Z' }), ctx(page.id));
    expect(res.status).toBe(409);
    const data = (await res.json()) as { current: { content: DocsBlock[]; updated_at: string } };
    expect(data.current.content[0].content).toBe('cero uno dos');
    expect(data.current.updated_at).toBe(merged.updated_at);
  });

  it('el mismo tramo editado por dos personas: gana quien guarda y lo otro queda en el historial', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Acta', content: [para('a', 'hola')] });
    await new Promise((r) => setTimeout(r, 5));
    await updateDocPage(owner.id, page.id, { content: [para('a', 'chau')], base_updated_at: page.updated_at });
    await new Promise((r) => setTimeout(r, 5));
    const saved = await updateDocPage(owner.id, page.id, { content: [para('a', 'adiós')], base_updated_at: page.updated_at });
    expect(saved?.content[0].content).toBe('adiós');
    const versions = await listDocVersions(owner.id, page.id);
    const contents = await Promise.all(versions.map(async (v) => (await getDocVersion(owner.id, page.id, v.id))?.content.map((b) => b.content).join('|')));
    expect(contents).toContain('chau');
  });
});

describe('Docs D3: presencia en vivo', () => {
  it('cada sesión ve a las demás con su cursor y recibe la versión nueva', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const page = await createDocPage(owner.id, { title: 'Live', content: [para('a', 'hola')] });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'edit');
    const url = `http://x/api/docs/pages/${page.id}/live`;
    session.user = { id: owner.id, email: owner.email };
    let res = await liveRoute.POST(req(url, 'POST', { session: 'sessionAAAA1', block_id: 'a', start: 2, end: 2, mode: 'edit', since: page.updated_at }), ctx(page.id));
    expect(res.status).toBe(200);
    session.user = { id: guest.id, email: guest.email };
    res = await liveRoute.POST(req(url, 'POST', { session: 'sessionBBBB2', mode: 'edit', since: 'viejo' }), ctx(page.id));
    const pulse = (await res.json()) as { peers: Array<{ user_id: string; block_id: string; start: number }>; page: { content: DocsBlock[] } | null };
    expect(pulse.peers).toHaveLength(1);
    expect(pulse.peers[0]).toMatchObject({ user_id: owner.id, block_id: 'a', start: 2 });
    expect(pulse.page?.content[0].content).toBe('hola');
    // Sin acceso: 404.
    const stranger = await makeUser('str');
    session.user = { id: stranger.id, email: stranger.email };
    res = await liveRoute.POST(req(url, 'POST', { session: 'sessionCCCC3' }), ctx(page.id));
    expect(res.status).toBe(404);
  });
});

describe('Docs D3: invitados externos', () => {
  it('un email sin cuenta queda invitado; al entrar con ese email ve solo la página y sus subpáginas', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Propuesta' });
    const sub = await createDocPage(owner.id, { title: 'Anexo', parent_id: page.id });
    const other = await createDocPage(owner.id, { title: 'Privada' });
    session.user = { id: owner.id, email: owner.email, name: 'Dueña' };
    const email = `ext-${crypto.randomUUID().slice(0, 6)}@cliente.test`;
    const res = await shareRoute.POST(req(`http://x/api/docs/pages/${page.id}/share`, 'POST', { kind: 'user', email, role: 'comment' }), ctx(page.id));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { invite: { email: string } }).invite.email).toBe(email);
    expect(await listPageInvites(page.id)).toHaveLength(1);

    // El token llega por mail: se crea uno nuevo para el test (renueva la misma invitación).
    const { token } = await createGuestInvite({ page: (await getDocPageRow(page.id))!, email, role: 'comment', invitedBy: owner });
    const wrong = await makeUser('wrong');
    expect(await acceptGuestInvite(token, wrong)).toMatchObject({ ok: false, reason: 'email_mismatch' });
    const { upsertUser } = await import('@/lib/db');
    const guest = await upsertUser({ id: `g-${crypto.randomUUID().slice(0, 8)}`, email, name: 'Cliente', image: null });
    expect(await acceptGuestInvite(token, guest)).toMatchObject({ ok: true, pageId: page.id });
    // Un segundo clic no duplica.
    expect(await acceptGuestInvite(token, guest)).toMatchObject({ ok: true });
    const actor = { id: guest.id };
    expect(await getDocAccess((await getDocPageRow(page.id))!, actor as never)).toBe('comment');
    expect(await getDocAccess((await getDocPageRow(sub.id))!, actor as never)).toBe('comment');
    expect(await getDocAccess((await getDocPageRow(other.id))!, actor as never)).toBeNull();
  });

  it('con invitados desactivados en Seguridad, un miembro no puede invitar afuera', async () => {
    const { owner, asMember } = await workspace();
    const page = await createDocPage(owner.id, { title: 'X' });
    await updateDocsSettings(owner.id, { allow_guests: false });
    session.user = asMember;
    const res = await shareRoute.POST(req(`http://x/api/docs/pages/${page.id}/share`, 'POST', { kind: 'user', email: 'nadie@afuera.test', role: 'view' }), ctx(page.id));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('guests_disabled');
  });

  it('"acceso total" de un invitado le deja compartir esa página', async () => {
    const owner = await makeUser('own');
    const guest = await makeUser('gst');
    const friend = await makeUser('frd');
    const page = await createDocPage(owner.id, { title: 'Compartible' });
    await createDocShare(owner.id, page.id, 'user', guest.id, 'full');
    session.user = { id: guest.id, email: guest.email };
    const res = await shareRoute.POST(req(`http://x/api/docs/pages/${page.id}/share`, 'POST', { kind: 'user', target_id: friend.id, role: 'view' }), ctx(page.id));
    expect(res.status).toBe(201);
    expect(await getDocAccess((await getDocPageRow(page.id))!, { id: friend.id } as never)).toBe('view');
    // El link público o publicar: no.
    const pub = await shareRoute.POST(req(`http://x/api/docs/pages/${page.id}/share`, 'POST', { kind: 'public' }), ctx(page.id));
    expect(pub.status).toBe(403);
  });
});

describe('Docs D3: teamspaces', () => {
  it('privado: no lo ven quienes no son miembros (ni el árbol ni el acceso); abierto sí', async () => {
    const { owner, member, asMember } = await workspace();
    const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
    const open = await createTeamspace(owner.id, owner.id, { name: 'Todos', access: 'open' });
    const secret = await createDocPage(owner.id, { title: 'Sueldos', teamspace_id: priv.id });
    const child = await createDocPage(owner.id, { title: 'Detalle', parent_id: secret.id });
    const pub = await createDocPage(owner.id, { title: 'Bienvenida', teamspace_id: open.id });
    expect((await getDocPageRow(child.id))!.teamspace_id).toBe(priv.id);
    const hidden = await hiddenTeamspaceIds(owner.id, member.id);
    expect(hidden).toEqual([priv.id]);
    const ids = (await listDocPageSummaries(owner.id, { hide: hidden })).map((p) => p.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(secret.id);
    expect(ids).not.toContain(child.id);
    expect(await getDocAccess((await getDocPageRow(secret.id))!, asMember as never)).toBeNull();
    expect(await getDocAccess((await getDocPageRow(pub.id))!, asMember as never)).toBe('edit');
    await setTeamspaceMember(priv.id, member.id, 'member');
    expect(await getDocAccess((await getDocPageRow(child.id))!, asMember as never)).toBe('edit');
    expect(await hiddenTeamspaceIds(owner.id, member.id)).toEqual([]);
  });
});

describe('Docs D3: auditoría y export', () => {
  it('registra, filtra por grupo y exporta CSV sin fórmulas', async () => {
    const owner = await makeUser('own');
    await logDocsAudit({ workspaceId: owner.id, actor: owner, action: 'share.added', page: { id: 'p1', title: '=HYPERLINK("x")' } });
    await logDocsAudit({ workspaceId: owner.id, actor: owner, action: 'page.exported', page: { id: 'p1', title: 'Doc' } });
    expect((await listDocsAudit(owner.id, { action: 'share' })).map((r) => r.action)).toEqual(['share.added']);
    const csv = auditToCsv(await listDocsAudit(owner.id));
    expect(csv.split('\n')[0]).toBe('created_at,actor,actor_id,action,page,page_id,detail,ip');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('exportar apagado en Seguridad: solo admins exportan', async () => {
    const { owner, asMember } = await workspace();
    const page = await createDocPage(owner.id, { title: 'Doc' });
    await updateDocsSettings(owner.id, { allow_export: false });
    session.user = asMember;
    const res = await exportRoute.GET(req(`http://x/api/docs/pages/${page.id}/export?format=md`, 'GET'), ctx(page.id));
    expect(res.status).toBe(403);
    session.user = { id: owner.id, email: owner.email };
    expect((await exportRoute.GET(req(`http://x/api/docs/pages/${page.id}/export?format=md`, 'GET'), ctx(page.id))).status).toBe(200);
  });

  it('el export no incluye sugerencias pendientes ni resaltados', async () => {
    const owner = await makeUser('own');
    const sug = applySuggestEdit('Hola mundo', 'Hola gran mundo', owner.id, () => 'sx');
    const page = await createDocPage(owner.id, { title: 'Doc', content: [para('a', wrapComment(sug.html, 0, 4, 'cm'))] });
    session.user = { id: owner.id, email: owner.email };
    const md = await (await exportRoute.GET(req(`http://x/api/docs/pages/${page.id}/export?format=md`, 'GET'), ctx(page.id))).text();
    expect(md).toContain('Hola mundo');
    expect(md).not.toContain('gran');
  });
});

describe('Docs D3: páginas verificadas', () => {
  it('al vencer avisa al dueño una sola vez (claim por fila)', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Onboarding' });
    const row = (await getDocPageRow(page.id))!;
    const past = new Date(Date.now() - 10 * 86_400_000);
    await verifyDocPage(row, owner.id, 7, null, 'es', past);
    const verified = (await getDocPageRow(page.id))!;
    expect(verified.page_owner_id).toBe(owner.id);
    expect(Date.parse(verified.verified_until!)).toBeLessThan(Date.now());
    const [a, b] = await Promise.all([fireVerificationExpiry(), fireVerificationExpiry()]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const notes = (await getDb().prepare('SELECT title FROM notifications WHERE user_id = ? AND source_id = ?').all(owner.id, page.id)) as Array<{ title: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain('Onboarding');
    expect(await fireVerificationExpiry()).toBe(0);
    // Verificar de nuevo reinicia el aviso; sin vencimiento no avisa nunca.
    await verifyDocPage(row, owner.id, null, null);
    expect((await getDocPageRow(page.id))!.verified_until).toBeNull();
    expect(await fireVerificationExpiry()).toBe(0);
  });
});

describe('Docs D3: comentarios sobre texto', () => {
  it('el hilo guarda el ancla y la cita', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Doc' });
    const c = await createDocComment(page.id, owner.id, { body: '¿Seguro?', block_id: 'a', anchor_id: 'anc1', quote: 'el precio' });
    expect(c).toMatchObject({ anchor_id: 'anc1', quote: 'el precio', block_id: 'a' });
    const reply = await createDocComment(page.id, owner.id, { body: 'Sí', parent_id: c.id, anchor_id: 'otro', quote: 'x' });
    // Las respuestas no llevan ancla propia.
    expect(reply).toMatchObject({ anchor_id: null, quote: '' });
  });
});

describe('Docs D3: la IA no lee teamspaces cerrados o privados', () => {
  /** Página con "La IA puede usarla" prendido, con una palabra única para buscarla. */
  async function aiPage(owner: { id: string }, word: string, teamspace_id: string | null) {
    const page = await createDocPage(owner.id, { title: `Política ${word}`, teamspace_id, content: [para('a', `La ${word} se pide con una semana de anticipo.`)] });
    await updateDocPage(owner.id, page.id, { is_public: true });
    return page;
  }

  it('Chat (bot y retrieval) y Agents filtran por teamspace; habilitarlo en el teamspace lo vuelve a sumar', async () => {
    const owner = await makeUser('own');
    const priv = await createTeamspace(owner.id, owner.id, { name: 'RRHH', access: 'private' });
    const closed = await createTeamspace(owner.id, owner.id, { name: 'Legal', access: 'closed' });
    const open = await createTeamspace(owner.id, owner.id, { name: 'Todos', access: 'open' });
    const secret = await aiPage(owner, 'licenciazeta', priv.id);
    await aiPage(owner, 'contratoomega', closed.id);
    await aiPage(owner, 'bienvenidaalfa', open.id);
    await aiPage(owner, 'vacacionesbeta', null);

    const { retrieveKnowledge } = await import('@/lib/chat-bot-ai');
    const { findBotReply } = await import('@/lib/chat-data');
    const { searchAgentKnowledge } = await import('@/lib/agent-tools');
    const widget = { id: `w-${crypto.randomUUID()}`, user_id: owner.id, bot_enabled: 1, bot_source: 'docs', bot_greeting: null } as never;
    const agent = { id: `ag-${crypto.randomUUID()}`, knowledge: { allPublicDocs: true, docsPageIds: [secret.id], cannedFromWidgetId: null, urls: [] } } as never;

    const titles = async (q: string) => [
      ...(await retrieveKnowledge(widget, q)).map((c) => c.title),
      ...(await searchAgentKnowledge(agent, owner.id, q)).map((c) => c.title),
    ];
    expect(await titles('licenciazeta')).not.toContain('Política licenciazeta');
    expect(await titles('contratoomega')).not.toContain('Política contratoomega');
    expect(await titles('bienvenidaalfa')).toContain('Política bienvenidaalfa');
    expect(await titles('vacacionesbeta')).toContain('Política vacacionesbeta');
    expect(((await findBotReply(widget, 'licenciazeta anticipo'))?.body ?? '')).not.toContain('licenciazeta');

    // Búsqueda de Docs y ⌘K (searchDocPagesContent con los teamspaces ocultos de quien busca).
    const { searchDocPagesContent } = await import('@/lib/docs');
    const member = await makeUser('mem');
    const hide = await hiddenTeamspaceIds(owner.id, member.id);
    expect((await searchDocPagesContent(owner.id, 'licenciazeta', 20, hide)).length).toBe(0);
    expect((await searchDocPagesContent(owner.id, 'licenciazeta', 20, [])).length).toBe(1);

    // Prenderlo en el teamspace: entra.
    const { updateTeamspace } = await import('@/lib/docs-access');
    await updateTeamspace(priv.id, { ai_knowledge: true });
    expect(await titles('licenciazeta')).toContain('Política licenciazeta');
  });
});

describe('Docs D3: bloques sincronizados', () => {
  it('copiar un sincronizado pide poder abrir la página de origen', async () => {
    const { owner, member, asMember } = await workspace();
    const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
    const src = await createDocPage(owner.id, { title: 'Origen', teamspace_id: priv.id });
    const { persistSyncedBlocks } = await import('@/lib/docs-synced');
    await persistSyncedBlocks({
      workspaceId: owner.id,
      pageId: src.id,
      actorId: owner.id,
      previous: [],
      next: [{ id: 's', type: 'synced', content: '', synced_id: 'sync-secreto' }, { id: 'c', type: 'paragraph', content: 'Sueldos', indent: 1 }],
    });
    const route = await import('@/app/api/docs/synced/[id]/route');
    const get = () => route.GET(req('http://x/api/docs/synced/sync-secreto', 'GET'), ctx('sync-secreto'));
    session.user = { id: owner.id, email: owner.email };
    expect((await get()).status).toBe(200);
    session.user = asMember;
    expect((await get()).status).toBe(404);
    await setTeamspaceMember(priv.id, member.id, 'member');
    expect((await get()).status).toBe(200);
  });

  it('sin acceso a la página de origen: "sin acceso" en la API y el export, y guardar no toca su contenido', async () => {
    const { owner, member, asMember } = await workspace();
    const priv = await createTeamspace(owner.id, owner.id, { name: 'Dirección', access: 'private' });
    const src = await createDocPage(owner.id, { title: 'Origen', teamspace_id: priv.id });
    const synced: DocsBlock[] = [{ id: 's', type: 'synced', content: '', synced_id: 'sync-sueldos' }, { ...para('c', 'Sueldos 2027'), indent: 1 }];
    await updateDocPage(owner.id, src.id, { content: synced }, { actorId: owner.id });
    // La copia en una página que el miembro sí puede abrir.
    const host = await createDocPage(owner.id, { title: 'Pública', content: [para('a', 'Hola'), ...synced] });
    const url = `http://x/api/docs/pages/${host.id}`;
    session.user = asMember;
    let res = await pageRoute.GET(req(url, 'GET'), ctx(host.id));
    const seen = (await res.json()) as { content: DocsBlock[]; updated_at: string };
    expect(seen.content.map((b) => b.id)).toEqual(['a', 's']);
    expect(seen.content[1].no_access).toBe(true);
    expect(JSON.stringify(seen.content)).not.toContain('Sueldos');
    const md = await (await exportRoute.GET(Object.assign(req(`${url}/export?format=md`, 'GET'), { nextUrl: new URL(`${url}/export?format=md`) }), ctx(host.id))).text();
    expect(md).not.toContain('Sueldos');
    // Guarda la página tal como la ve (el sincronizado sin hijos) y hasta inventa hijos: no se toca nada.
    res = await pageRoute.PATCH(
      req(url, 'PATCH', { content: [para('a', 'Hola mundo'), { id: 's', type: 'synced', content: '', synced_id: 'sync-sueldos' }, { ...para('x', 'Pisado'), indent: 1 }], base_updated_at: seen.updated_at }),
      ctx(host.id),
    );
    expect(res.status).toBe(200);
    const { getSyncedBlock } = await import('@/lib/docs-synced');
    expect((await getSyncedBlock(owner.id, 'sync-sueldos'))?.map((b) => b.content)).toEqual(['Sueldos 2027']);
    const stored = parseBlocks((await getDocPageRow(host.id))!.content);
    expect(stored.map((b) => b.content)).toEqual(['Hola mundo', '', 'Sueldos 2027']);
    // Con acceso al teamspace, se ve el contenido.
    await setTeamspaceMember(priv.id, member.id, 'member');
    res = await pageRoute.GET(req(url, 'GET'), ctx(host.id));
    const after = (await res.json()) as { content: DocsBlock[] };
    expect(after.content.map((b) => b.content)).toEqual(['Hola mundo', '', 'Sueldos 2027']);
    expect(after.content[1].no_access).toBeUndefined();
  });
});

describe('Docs D3: teamspace por defecto y desbloquear solo para mí', () => {
  it('el teamspace por defecto incluye a todo el workspace aunque sea cerrado', async () => {
    const { owner, member, asMember } = await workspace();
    const general = await createTeamspace(owner.id, owner.id, { name: 'General', access: 'closed', is_default: true });
    const other = await createTeamspace(owner.id, owner.id, { name: 'Otro', access: 'closed', is_default: true });
    // Uno solo por workspace: el último gana.
    const { getTeamspace, listTeamspaces } = await import('@/lib/docs-access');
    expect((await getTeamspace(general.id))!.is_default).toBe(false);
    expect((await getTeamspace(other.id))!.is_default).toBe(true);
    const page = await createDocPage(owner.id, { title: 'Hola', teamspace_id: other.id });
    expect(await hiddenTeamspaceIds(owner.id, member.id)).toEqual([general.id]);
    expect(await getDocAccess((await getDocPageRow(page.id))!, asMember as never)).toBe('edit');
    expect((await listTeamspaces(owner.id, member.id)).find((t) => t.id === other.id)?.my_role).toBe('member');
  });

  it('con "solo para mí" quien edita guarda en una página bloqueada; sin eso, 423', async () => {
    const owner = await makeUser('own');
    const page = await createDocPage(owner.id, { title: 'Bloq', content: [para('a', 'uno')] });
    await updateDocPage(owner.id, page.id, { locked: true });
    session.user = { id: owner.id, email: owner.email };
    const url = `http://x/api/docs/pages/${page.id}`;
    let row = (await getDocPageRow(page.id))!;
    expect((await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'dos')], base_updated_at: row.updated_at }), ctx(page.id))).status).toBe(423);
    const res = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'dos')], base_updated_at: row.updated_at, bypass_lock: true }), ctx(page.id));
    expect(res.status).toBe(200);
    row = (await getDocPageRow(page.id))!;
    expect(row.locked).toBe(1);
    // Quien solo comenta no puede saltear el bloqueo.
    const guest = await makeUser('gst');
    await createDocShare(owner.id, page.id, 'user', guest.id, 'comment');
    session.user = { id: guest.id, email: guest.email };
    const g = await pageRoute.PATCH(req(url, 'PATCH', { content: [para('a', 'tres')], base_updated_at: row.updated_at, bypass_lock: true }), ctx(page.id));
    expect([403, 423]).toContain(g.status);
  });
});
