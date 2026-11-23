import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/session';
import { createIssue, createProject } from '@/lib/track-data';
import { setProjectVisibility } from '@/lib/track-access';
import { createNotification } from '@/lib/notifications';
import { EMPTY_INBOX_FILTER, inboxReason, inboxTab } from '@/lib/notification-inbox-filter';
import { listInboxNotifications } from '@/lib/notification-inbox';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const { GET } = await import('@/app/api/notifications/inbox/route');
const { PATCH } = await import('@/app/api/notifications/[id]/route');

describe('Priority inbox: la regla', () => {
  const tab = (type: string, extra: { source_type?: string; meta?: Record<string, unknown> } = {}) =>
    inboxTab({ type, source_type: extra.source_type ?? 'track_issue', meta: extra.meta ?? {} });

  it('asignaciones, menciones, recordatorios, triage, SLA y cambios de status o prioridad van a Priority', () => {
    expect(tab('assigned')).toBe('priority');
    expect(tab('mention')).toBe('priority');
    expect(tab('track_reminder')).toBe('priority');
    expect(tab('status_change')).toBe('priority');
    expect(tab('issue_update', { meta: { changes: 'title,priority' } })).toBe('priority');
    expect(tab('issue_update', { source_type: 'track_triage', meta: { kind: 'triage_owner' } })).toBe('priority');
    expect(tab('issue_update', { source_type: 'track_sla', meta: { kind: 'sla_breach' } })).toBe('priority');
    expect(tab('talk_mention', { source_type: 'talk' })).toBe('priority');
  });

  it('comentarios, otras ediciones, sub-issues, relaciones y updates de projects van a Other', () => {
    expect(tab('comment')).toBe('other');
    expect(tab('issue_update', { meta: { changes: 'title,description' } })).toBe('other');
    expect(tab('subtask')).toBe('other');
    expect(tab('relation')).toBe('other');
    expect(tab('project_update', { source_type: 'track_plan' })).toBe('other');
    expect(tab('chat_message', { source_type: 'chat' })).toBe('other');
  });

  it('la razón explica la acción', () => {
    expect(inboxReason({ type: 'assigned', meta: {} })).toBe('assigned');
    expect(inboxReason({ type: 'mention', meta: {} })).toBe('mentioned');
    expect(inboxReason({ type: 'issue_update', meta: { changes: 'priority' } })).toBe('priority');
    expect(inboxReason({ type: 'issue_update', source_type: 'track_sla', meta: { kind: 'sla_risk' } })).toBe('sla_risk');
    expect(inboxReason({ type: 'issue_update', source_type: 'track_triage', meta: { kind: 'triage_owner' } })).toBe('triage');
  });
});

/**
 * Un workspace con un team abierto y uno privado (solo el owner), y una
 * persona de otro workspace con un aviso viejo de un issue del primero.
 */
async function setup() {
  const w = await workspaceWithMember('inbox-prio');
  const open = await createProject(w.owner.id, w.team.id, { name: 'Abierto' });
  const secret = await createProject(w.owner.id, w.team.id, { name: 'Privado' });
  await setProjectVisibility(secret.id, 'private', w.owner.id);
  const openIssue = await createIssue(open.id, w.owner.id, { title: 'Issue abierto', priority: 'low', description: [] });
  const secretIssue = await createIssue(secret.id, w.owner.id, { title: 'Plan secreto', priority: 'low', description: [] });
  const notify = (userId: string, issue: { id: string; identifier: string }, type: 'assigned' | 'comment' | 'status_change') =>
    createNotification({
      userId,
      type,
      title: `${issue.identifier} ${type}`,
      body: 'Plan secreto',
      href: `/app/track/issues/${issue.id}`,
      sourceType: 'track_issue',
      sourceId: issue.id,
      meta: { issueIdentifier: issue.identifier, actorName: 'Ana', actorId: 'ana', newStatus: 'Done' },
    });
  // A la persona del equipo: un aviso de cada team (el privado de antes de que lo cerraran).
  await notify(w.member.id, openIssue, 'assigned');
  await notify(w.member.id, openIssue, 'comment');
  await notify(w.member.id, secretIssue, 'status_change');
  // Al owner: los dos.
  await notify(w.owner.id, openIssue, 'assigned');
  await notify(w.owner.id, secretIssue, 'status_change');
  // A alguien de otro workspace (dejó el equipo): un aviso del team abierto.
  await notify(w.stranger.id, openIssue, 'assigned');
  return { w, openIssue, secretIssue };
}

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/notifications/inbox${qs}`));

describe('Priority inbox: privacidad y pestañas', () => {
  it('anónimo: 401', async () => {
    session.user = null;
    expect((await get()).status).toBe(401);
  });

  it('cada persona ve solo avisos de issues que hoy puede ver, sin títulos de teams privados', async () => {
    const { w, openIssue, secretIssue } = await setup();

    // Otro workspace: el aviso viejo no se muestra.
    session.user = asOwner(w.stranger);
    const stranger = (await (await get()).json()) as { rows: Array<{ issue: { id: string } | null }>; counts: { priority: number } };
    expect(stranger.rows).toHaveLength(0);
    expect(stranger.counts.priority).toBe(0);

    // Persona del equipo sin acceso al team privado: el del privado no aparece en ninguna pestaña.
    session.user = asMember(w.owner, w.member);
    for (const tab of ['priority', 'other']) {
      const res = await get(`?tab=${tab}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(secretIssue.id);
      expect(text).not.toContain(secretIssue.identifier);
    }
    const priority = (await (await get('?tab=priority')).json()) as {
      rows: Array<{ id: string; tab: string; reason: string; issue: { id: string; title: string } | null }>;
      counts: { priority: number; other: number };
    };
    expect(priority.rows.map((r) => r.issue?.id)).toEqual([openIssue.id]);
    expect(priority.rows[0]).toMatchObject({ tab: 'priority', reason: 'assigned' });
    // El título es el del issue hoy, no el que quedó guardado en el aviso.
    expect(priority.rows[0].issue?.title).toBe('Issue abierto');
    expect(priority.counts).toEqual({ priority: 1, other: 1 });
    const other = (await (await get('?tab=other')).json()) as { rows: Array<{ id: string; reason: string }> };
    expect(other.rows.map((r) => r.reason)).toEqual(['commented']);

    // Leída: deja de contar; U la vuelve a sin leer.
    const readRes = await PATCH(new NextRequest(`http://localhost/api/notifications/${priority.rows[0].id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) }), {
      params: Promise.resolve({ id: priority.rows[0].id }),
    });
    expect(readRes.status).toBe(200);
    expect(((await (await get('?tab=priority')).json()) as { counts: { priority: number } }).counts.priority).toBe(0);
    await PATCH(new NextRequest(`http://localhost/api/notifications/${priority.rows[0].id}`, { method: 'PATCH', body: JSON.stringify({ read: false }) }), {
      params: Promise.resolve({ id: priority.rows[0].id }),
    });
    expect(((await (await get('?tab=priority')).json()) as { counts: { priority: number } }).counts.priority).toBe(1);

    // Otra persona no puede tocar un aviso ajeno.
    session.user = asOwner(w.stranger);
    await PATCH(new NextRequest(`http://localhost/api/notifications/${priority.rows[0].id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) }), {
      params: Promise.resolve({ id: priority.rows[0].id }),
    });
    session.user = asMember(w.owner, w.member);
    expect(((await (await get('?tab=priority')).json()) as { counts: { priority: number } }).counts.priority).toBe(1);

    // Owner (con acceso al privado): ve los dos, con el título actual.
    session.user = asOwner(w.owner);
    const owner = (await (await get('?tab=priority')).json()) as { rows: Array<{ issue: { id: string; title: string } | null; reason: string }> };
    expect(owner.rows.map((r) => r.issue?.id).sort()).toEqual([openIssue.id, secretIssue.id].sort());
    expect(owner.rows.find((r) => r.issue?.id === secretIssue.id)?.reason).toBe('status');
  });

  it('miembro: al sumarlo al team privado aparece el aviso', async () => {
    const { w, secretIssue } = await setup();
    const { addProjectAccess } = await import('@/lib/track-access');
    await addProjectAccess(secretIssue.project_id, w.member.id, w.owner.id);
    const page = await listInboxNotifications(w.member.id, { filter: EMPTY_INBOX_FILTER, tab: 'priority' });
    expect(page.rows.map((r) => r.issue?.id)).toContain(secretIssue.id);
  });

  it('invitado: no ve avisos de projects ni el nombre del project en los de issues', async () => {
    const { w, openIssue } = await setup();
    const { setGuest } = await import('@/lib/track-access');
    const { createPlan } = await import('@/lib/track-plans');
    const { planCreateSchema } = await import('@/lib/track-planning-schema');
    const created = await createPlan({ teamId: w.team.id, ownerId: w.owner.id }, w.owner.id, planCreateSchema.parse({ name: 'Plan de lanzamiento' }));
    if (!created.ok) throw new Error(created.error);
    const plan = created.plan;
    await createNotification({
      userId: w.member.id,
      type: 'project_update',
      title: 'Update on Plan de lanzamiento',
      body: 'secreto',
      href: `/app/track/projects/${plan.id}`,
      sourceType: 'track_plan',
      sourceId: plan.id,
      meta: { planName: 'Plan de lanzamiento', actorName: 'Ana' },
    });
    const before = await listInboxNotifications(w.member.id, { filter: EMPTY_INBOX_FILTER, tab: 'other' });
    expect(before.rows.some((r) => r.source_id === plan.id)).toBe(true);
    await setGuest(w.team.id, w.member.email, [openIssue.project_id], w.owner.id);
    const after = await listInboxNotifications(w.member.id, { filter: EMPTY_INBOX_FILTER });
    expect(after.rows.some((r) => r.source_id === plan.id)).toBe(false);
    expect(JSON.stringify(after)).not.toContain('Plan de lanzamiento');
    // El aviso del issue de su team sigue.
    expect(after.rows.some((r) => r.issue?.id === openIssue.id)).toBe(true);
  });
});
