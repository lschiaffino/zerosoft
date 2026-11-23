import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import {
  createIssue,
  createProject,
  deleteIssueRelation,
  deleteProject,
  getIssue,
  listIssueActivities,
  listStatuses,
  updateProject,
} from '@/lib/track-data';
import { addProjectAccess, runAsTrackViewer, setGuest, setProjectVisibility } from '@/lib/track-access';
import { setIssueSubscription, listIssueSubscriberIds } from '@/lib/track-subscriptions';
import { ensureDuplicateStatus, getDuplicateMark, markIssueDuplicate, unmarkIssueDuplicate } from '@/lib/track-duplicates';
import { claimTriage, resolveTriage } from '@/lib/track-bulk';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {}, emitEventSoon: async () => {} }));

const route = await import('@/lib/routes/track/issues/[id]/duplicate-of/route');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
const del = () => new NextRequest('http://x', { method: 'DELETE' }) as never;
const get = () => new NextRequest('http://x') as never;

const uid = () => crypto.randomUUID().slice(0, 6);

/** Workspace con owner, un miembro, un invitado (solo Open) y teams Open, Other y Secret (privado). */
async function setup() {
  const owner = await makeUser('dup-own');
  const member = await makeUser('dup-mem');
  const guest = await makeUser('dup-gst');
  const stranger = await makeUser('dup-str');
  const team = await createTeam(owner.id, 'Acme');
  await addMember(team.id, member.id);
  await addMember(team.id, guest.id);
  const open = await createProject(owner.id, team.id, { name: 'Open', slug: `op-${uid()}` });
  const other = await createProject(owner.id, team.id, { name: 'Other', slug: `ot-${uid()}` });
  const secret = await createProject(owner.id, team.id, { name: 'Secret', slug: `se-${uid()}` });
  await setProjectVisibility(secret.id, 'private', owner.id);
  await setGuest(team.id, guest.email, [open.id], owner.id);
  const theirs = await createProject(stranger.id, null, { name: 'Theirs', slug: `th-${uid()}` });
  const app = { source: 'app' as const };
  const original = await createIssue(open.id, owner.id, { title: 'Login fails on Safari' }, app);
  const dup = await createIssue(open.id, member.id, { title: 'Safari login broken', description: [{ type: 'text', text: 'Steps: open **Safari**, try to log in.' }] }, app);
  const otherIssue = await createIssue(other.id, owner.id, { title: 'Other team issue' }, app);
  const secretIssue = await createIssue(secret.id, owner.id, { title: 'Secret roadmap item' }, app);
  const foreign = await createIssue(theirs.id, stranger.id, { title: 'Foreign' }, app);
  const as = {
    owner: { ...owner, team, role: 'owner' },
    member: { ...member, id: owner.id, actingUser: member, team, role: 'member' },
    guest: { ...guest, id: owner.id, actingUser: guest, team, role: 'member' },
    stranger: { ...stranger, team: null, role: 'owner' },
  };
  return { owner, member, guest, stranger, team, open, other, secret, theirs, original, dup, otherIssue, secretIssue, foreign, as };
}

describe('Track: estado Duplicado', () => {
  it('marca: estado Duplicate (cancelado), relación, suscriptos, pedidos y resumen; deshacer lo vuelve todo', async () => {
    const s = await setup();
    session.user = s.as.owner;
    const before = (await getIssue(s.dup.id))!;
    // Un pedido de cliente y un suscripto propio del duplicado.
    await getDb()
      .prepare("INSERT INTO track_customer_requests (id, workspace_id, issue_id, customer_name, body) VALUES (?, ?, ?, 'Acme', 'please fix')")
      .run(`req-${uid()}`, s.team.id, s.dup.id);
    const watcher = await makeUser('dup-watch');
    await addMember(s.team.id, watcher.id);
    await setIssueSubscription(s.dup.id, watcher.id, true);
    // Quien se dio de baja del original no vuelve a quedar suscripto.
    await setIssueSubscription(s.original.id, s.member.id, false);

    const res = await route.POST(post({ originalId: s.original.identifier }), params(s.dup.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mark: { original: { id: string } }; moved: { subscribers: number; requests: number } };
    expect(body.mark.original.id).toBe(s.original.id);
    expect(body.moved).toEqual({ subscribers: 1, requests: 1 });

    const after = (await getIssue(s.dup.id))!;
    expect(after.status_category).toBe('cancelled');
    expect(after.status_name).toBe('Duplicate');
    const statuses = await listStatuses(s.open.id);
    expect(statuses.filter((x) => x.name === 'Duplicate')).toHaveLength(1);
    const rel = await getDb().prepare('SELECT type FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?').get(s.dup.id, s.original.id);
    expect(rel).toEqual({ type: 'duplicates' });
    const subs = await listIssueSubscriberIds(s.original.id);
    expect(subs).toContain(watcher.id);
    expect(subs).not.toContain(s.member.id);
    const req = (await getDb().prepare('SELECT issue_id FROM track_customer_requests WHERE workspace_id = ?').get(s.team.id)) as { issue_id: string };
    expect(req.issue_id).toBe(s.original.id);
    const summary = (await listIssueActivities(s.original.id)).find((a) => a.type === 'relation_added' && JSON.parse(a.meta).merged);
    const meta = JSON.parse(summary!.meta) as Record<string, unknown>;
    expect(meta).toMatchObject({ identifier: s.dup.identifier, title: 'Safari login broken', subscribers: 1, requests: 1 });
    expect(String(meta.excerpt)).toBe('Steps: open Safari, try to log in.');

    // GET ve la marca; marcar otra vez con el mismo original no mueve nada de nuevo.
    expect(((await (await route.GET(get(), params(s.dup.id))).json()) as { mark: { original: { identifier: string } } }).mark.original.identifier).toBe(
      s.original.identifier,
    );
    expect((await route.POST(post({ originalId: s.original.id }), params(s.dup.id))).status).toBe(200);
    expect(await listStatuses(s.open.id)).toHaveLength(statuses.length);

    // Deshacer.
    const undo = await route.DELETE(del(), params(s.dup.id));
    expect(undo.status).toBe(200);
    const back = (await getIssue(s.dup.id))!;
    expect(back.status_id).toBe(before.status_id);
    expect(await getDb().prepare('SELECT 1 FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?').get(s.dup.id, s.original.id)).toBeUndefined();
    expect(await listIssueSubscriberIds(s.original.id)).not.toContain(watcher.id);
    expect(((await getDb().prepare('SELECT issue_id FROM track_customer_requests WHERE workspace_id = ?').get(s.team.id)) as { issue_id: string }).issue_id).toBe(s.dup.id);
    expect((await listIssueActivities(s.original.id)).some((a) => a.type === 'relation_added' && JSON.parse(a.meta).merged)).toBe(false);
    expect(await getDuplicateMark(s.dup.id)).toBeNull();
    // Deshacer dos veces: 409, nada que deshacer.
    expect((await route.DELETE(del(), params(s.dup.id))).status).toBe(409);
    session.user = null;
  });

  it('acceso: anónimo, otro workspace, team privado sin acceso, invitado, miembro y owner', async () => {
    const s = await setup();
    // Anónimo.
    session.user = null;
    expect((await route.POST(post({ originalId: s.original.id }), params(s.dup.id))).status).toBe(401);
    expect((await route.GET(get(), params(s.dup.id))).status).toBe(401);
    // Otro workspace: no ve el issue, ni puede apuntar al suyo como original.
    session.user = s.as.stranger;
    expect((await route.POST(post({ originalId: s.original.id }), params(s.dup.id))).status).toBe(404);
    expect((await route.POST(post({ originalId: s.original.id }), params(s.foreign.id))).status).toBe(400);
    session.user = s.as.owner;
    expect((await route.POST(post({ originalId: s.foreign.id }), params(s.dup.id))).status).toBe(400);
    // Miembro sin acceso al team privado: no ve el issue privado ni lo puede elegir como original.
    session.user = s.as.member;
    expect((await route.POST(post({ originalId: s.original.id }), params(s.secretIssue.id))).status).toBe(404);
    const hidden = await route.POST(post({ originalId: s.secretIssue.id }), params(s.dup.id));
    expect(hidden.status).toBe(400);
    expect(((await hidden.json()) as { error: string }).error).toBe('invalid_duplicate');
    expect((await route.POST(post({ originalId: s.secretIssue.identifier }), params(s.dup.id))).status).toBe(400);
    // Invitado: solo dentro de sus teams (Other no está en su lista).
    session.user = s.as.guest;
    expect((await route.POST(post({ originalId: s.original.id }), params(s.otherIssue.id))).status).toBe(404);
    expect((await route.POST(post({ originalId: s.otherIssue.id }), params(s.dup.id))).status).toBe(400);
    expect((await route.POST(post({ originalId: s.original.id }), params(s.dup.id))).status).toBe(200);
    expect((await route.DELETE(del(), params(s.dup.id))).status).toBe(200);
    // Miembro: entre teams abiertos.
    session.user = s.as.member;
    expect((await route.POST(post({ originalId: s.otherIssue.id }), params(s.dup.id))).status).toBe(200);
    expect((await route.DELETE(del(), params(s.dup.id))).status).toBe(200);
    // Owner, sumado al privado: lo puede elegir.
    session.user = s.as.owner;
    expect((await route.POST(post({ originalId: s.secretIssue.id }), params(s.dup.id))).status).toBe(200);
    // Y un miembro sin acceso que mira el duplicado no ve cuál es el original.
    session.user = s.as.member;
    const seen = (await (await route.GET(get(), params(s.dup.id))).json()) as { mark: { original: unknown } };
    expect(seen.mark.original).toBeNull();
    await addProjectAccess(s.secret.id, s.member.id, s.owner.id);
    const seen2 = (await (await route.GET(get(), params(s.dup.id))).json()) as { mark: { original: { id: string } | null } };
    expect(seen2.mark.original?.id).toBe(s.secretIssue.id);
    session.user = null;
  });

  it('privacidad: del team privado a uno abierto no pasa texto ni pedidos, y no suscribe a quien no ve el original', async () => {
    const s = await setup();
    // Duplicado en el team privado (con un miembro sumado y suscripto), original en uno abierto.
    const insider = await makeUser('dup-ins');
    await addMember(s.team.id, insider.id);
    await addProjectAccess(s.secret.id, insider.id, s.owner.id);
    await setIssueSubscription(s.secretIssue.id, insider.id, true);
    await getDb()
      .prepare("INSERT INTO track_customer_requests (id, workspace_id, issue_id, customer_name, body) VALUES (?, ?, ?, 'Acme', 'private context')")
      .run(`req-${uid()}`, s.team.id, s.secretIssue.id);
    const res = await runAsTrackViewer(s.owner.id, () => markIssueDuplicate(s.secretIssue.id, s.original.id, s.owner.id), 'app');
    expect(res.ok).toBe(true);
    const summary = (await listIssueActivities(s.original.id)).find((a) => JSON.parse(a.meta).merged);
    const meta = JSON.parse(summary!.meta) as Record<string, unknown>;
    // Ni título, ni extracto, ni identificador o id del issue privado en el original abierto.
    expect(meta.title).toBe('');
    expect(meta.excerpt).toBe('');
    expect(meta.identifier).toBe('');
    expect(meta.relatedIssueId).toBe('');
    expect(meta.subscribers).toBe(0);
    expect(JSON.stringify(meta)).not.toContain(s.secretIssue.identifier);
    expect(meta.requests).toBe(0);
    expect(((await getDb().prepare('SELECT issue_id FROM track_customer_requests WHERE workspace_id = ?').get(s.team.id)) as { issue_id: string }).issue_id).toBe(
      s.secretIssue.id,
    );
    // El insider ve Open (abierto): pasa. Al revés, alguien que no ve el original no pasaría.
    expect(await listIssueSubscriberIds(s.original.id)).toContain(insider.id);

    // Original privado: los suscriptos del duplicado sin acceso al privado no pasan.
    const outsider = await makeUser('dup-out');
    await addMember(s.team.id, outsider.id);
    const dup2 = await createIssue(s.open.id, s.owner.id, { title: 'Another' }, { source: 'app' });
    await setIssueSubscription(dup2.id, outsider.id, true);
    const secondOriginal = await createIssue(s.secret.id, s.owner.id, { title: 'Hidden original' }, { source: 'app' });
    expect((await runAsTrackViewer(s.owner.id, () => markIssueDuplicate(dup2.id, secondOriginal.id, s.owner.id), 'app')).ok).toBe(true);
    expect(await listIssueSubscriberIds(secondOriginal.id)).not.toContain(outsider.id);

    // Un invitado que ve Open y no Other: el texto de Other no se copia a Open.
    const dup3 = await createIssue(s.other.id, s.owner.id, { title: 'Other dup text' }, { source: 'app' });
    expect((await runAsTrackViewer(s.owner.id, () => markIssueDuplicate(dup3.id, s.original.id, s.owner.id), 'app')).ok).toBe(true);
    const metas = (await listIssueActivities(s.original.id)).map((a) => JSON.parse(a.meta) as Record<string, unknown>);
    expect(metas.some((m) => m.identifier === dup3.identifier)).toBe(false);

    // Un invitado suscripto a un duplicado de Open no pasa a un original de Other (no lo ve).
    const dup4 = await createIssue(s.open.id, s.owner.id, { title: 'Guest watched' }, { source: 'app' });
    await setIssueSubscription(dup4.id, s.guest.id, true);
    expect((await runAsTrackViewer(s.owner.id, () => markIssueDuplicate(dup4.id, s.otherIssue.id, s.owner.id), 'app')).ok).toBe(true);
    expect(await listIssueSubscriberIds(s.otherIssue.id)).not.toContain(s.guest.id);
  });

  it('cambiar de original devuelve el anterior (⌘Z vuelve a él), una marca en curso no se deshace, y borrar el team limpia', async () => {
    const s = await setup();
    const asOwner = <T,>(fn: () => Promise<T>) => runAsTrackViewer(s.owner.id, fn, 'app');
    const a = await createIssue(s.open.id, s.owner.id, { title: 'A' }, { source: 'app' });
    const b = await createIssue(s.open.id, s.owner.id, { title: 'B' }, { source: 'app' });
    const first = await asOwner(() => markIssueDuplicate(a.id, b.id, s.owner.id));
    expect(first.ok && first.previousOriginalId).toBeNull();
    const second = await asOwner(() => markIssueDuplicate(a.id, s.original.id, s.owner.id));
    expect(second.ok && second.previousOriginalId).toBe(b.id);
    // Volver a marcar con el anterior (lo que hace ⌘Z) deja la marca como antes.
    expect((await asOwner(() => markIssueDuplicate(a.id, b.id, s.owner.id))).ok).toBe(true);
    expect((await getDuplicateMark(a.id))?.original?.id).toBe(b.id);
    // Reabierto a mano y marcado con el mismo original: vuelve al estado Duplicate.
    const open = (await listStatuses(s.open.id)).find((x) => x.category === 'todo')!;
    await getDb().prepare('UPDATE track_issues SET status_id = ? WHERE id = ?').run(open.id, a.id);
    expect((await asOwner(() => markIssueDuplicate(a.id, b.id, s.owner.id))).ok).toBe(true);
    expect((await getIssue(a.id))!.status_name).toBe('Duplicate');

    // Una marca que otro request está haciendo (sin resumen todavía) no se deshace: 409 busy.
    const c = await createIssue(s.open.id, s.owner.id, { title: 'C' }, { source: 'app' });
    await getDb().prepare('INSERT INTO track_issue_duplicates (issue_id, original_id, created_by) VALUES (?, ?, ?)').run(c.id, b.id, s.owner.id);
    session.user = s.as.owner;
    const busy = await route.DELETE(del(), params(c.id));
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: string }).error).toBe('busy');
    // Pasado el minuto, se puede deshacer (una marca que se cortó).
    await getDb().prepare("UPDATE track_issue_duplicates SET created_at = '2020-01-01T00:00:00.000Z' WHERE issue_id = ?").run(c.id);
    expect((await route.DELETE(del(), params(c.id))).status).toBe(200);
    session.user = null;

    // Borrar el team del original: la marca del duplicado se va (sin banner colgado).
    const other = await createProject(s.owner.id, s.team.id, { name: 'Gone', slug: `go-${uid()}` });
    const target = await createIssue(other.id, s.owner.id, { title: 'Target' }, { source: 'app' });
    const d = await createIssue(s.open.id, s.owner.id, { title: 'D' }, { source: 'app' });
    expect((await asOwner(() => markIssueDuplicate(d.id, target.id, s.owner.id))).ok).toBe(true);
    await deleteProject(other.id);
    expect(await getDuplicateMark(d.id)).toBeNull();
    expect(await getDb().prepare('SELECT 1 FROM track_issue_duplicates WHERE issue_id = ?').get(d.id)).toBeUndefined();
  });

  it('triage: si otro lo aceptó recién, el duplicado responde not_in_triage y no deja marca', async () => {
    const s = await setup();
    await updateProject(s.other.id, { triageEnabled: true });
    const incoming = await createIssue(s.other.id, s.owner.id, { title: 'Race' }, { source: 'api' });
    expect(incoming.triage).toBe(1);
    // Alguien lo aceptó entre que se leyó y se marcó.
    expect(await claimTriage(incoming.id)).toBe(true);
    const res = await runAsTrackViewer(s.owner.id, () => resolveTriage(incoming, { action: 'duplicate', duplicateOfId: s.otherIssue.id }, s.owner.id), 'app');
    expect(res).toEqual({ ok: false, reason: 'not_in_triage' });
    expect(await getDuplicateMark(incoming.id)).toBeNull();
    const direct = await runAsTrackViewer(s.owner.id, () => markIssueDuplicate(incoming.id, s.otherIssue.id, s.owner.id), 'app');
    // Fuera de triage, marcarlo es una marca común.
    expect(direct.ok).toBe(true);
  });

  it('ciclos, cambio de original, relación borrada a mano y triage', async () => {
    const s = await setup();
    const asOwner = <T,>(fn: () => Promise<T>) => runAsTrackViewer(s.owner.id, fn, 'app');
    const a = await createIssue(s.open.id, s.owner.id, { title: 'A' }, { source: 'app' });
    const b = await createIssue(s.open.id, s.owner.id, { title: 'B' }, { source: 'app' });
    const c = await createIssue(s.open.id, s.owner.id, { title: 'C' }, { source: 'app' });
    expect((await asOwner(() => markIssueDuplicate(a.id, b.id, s.owner.id))).ok).toBe(true);
    // B duplicado de A cerraría un ciclo; A de sí mismo tampoco.
    expect(await asOwner(() => markIssueDuplicate(b.id, a.id, s.owner.id))).toEqual({ ok: false, reason: 'invalid_duplicate' });
    expect(await asOwner(() => markIssueDuplicate(a.id, a.id, s.owner.id))).toEqual({ ok: false, reason: 'invalid_duplicate' });
    // Cambiar de original: la marca pasa a C y la relación con B se va.
    expect((await asOwner(() => markIssueDuplicate(a.id, c.id, s.owner.id))).ok).toBe(true);
    expect((await getDuplicateMark(a.id))?.original?.id).toBe(c.id);
    expect(await getDb().prepare('SELECT 1 FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?').get(a.id, b.id)).toBeUndefined();
    // Borrar la relación a mano saca la marca (el estado queda).
    const rel = (await getDb().prepare('SELECT id FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?').get(a.id, c.id)) as { id: string };
    expect(await deleteIssueRelation(rel.id, a.id, s.owner.id)).toBe(true);
    expect(await getDuplicateMark(a.id)).toBeNull();
    expect((await getIssue(a.id))!.status_name).toBe('Duplicate');
    expect(await unmarkIssueDuplicate(a.id, s.owner.id)).toBe(false);

    // Triage: el duplicado va al estado Duplicate y deshacer lo devuelve a triage.
    await updateProject(s.other.id, { triageEnabled: true });
    const incoming = await createIssue(s.other.id, s.owner.id, { title: 'From API' }, { source: 'api' });
    expect(incoming.triage).toBe(1);
    const res = await asOwner(() => resolveTriage(incoming, { action: 'duplicate', duplicateOfId: s.otherIssue.id }, s.owner.id));
    expect(res.ok).toBe(true);
    const done = (await getIssue(incoming.id))!;
    expect([done.triage, done.status_name, done.status_category]).toEqual([0, 'Duplicate', 'cancelled']);
    expect(await unmarkIssueDuplicate(incoming.id, s.owner.id)).toBe(true);
    expect((await getIssue(incoming.id))!.triage).toBe(1);
  });

  it('el estado Duplicate se crea una vez, en el idioma del team, después del cancelado', async () => {
    const owner = await makeUser('dup-es');
    const p = await createProject(owner.id, null, { name: `Equipo ${uid()}` }, { locale: 'es' });
    const [x, y] = await Promise.all([ensureDuplicateStatus(p.id), ensureDuplicateStatus(p.id)]);
    expect(x).toBe(y);
    const list = await listStatuses(p.id);
    const dup = list.filter((st) => st.name === 'Duplicado');
    expect(dup).toHaveLength(1);
    expect(dup[0].category).toBe('cancelled');
    const cancelled = list.find((st) => st.name === 'Cancelado')!;
    expect(dup[0].position).toBeGreaterThan(cancelled.position);
    // Renombrado sigue siendo el de los duplicados.
    await getDb().prepare("UPDATE track_statuses SET name = 'Dupe' WHERE id = ?").run(dup[0].id);
    expect(await ensureDuplicateStatus(p.id)).toBe(dup[0].id);
  });
});
