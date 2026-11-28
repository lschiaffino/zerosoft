/**
 * CRM, bloque W3 (workflows como HubSpot): inscripción por criterios,
 * inscribir los registros que ya cumplen (con tope y de a tandas), sacar un
 * registro a mano y el registro por acción. Privacidad: el registro por
 * acción es solo para owner y admins y nunca lleva valores; un miembro con
 * alcance no ve inscripciones de criterios sobre otro registro, y nada de
 * esto deja inferir un campo oculto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCompany,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  moveDeal,
  updateContact,
} from '@/lib/crm';
import {
  createWorkflow,
  enrollExistingRecords,
  listRecordEnrollments,
  listWorkflowRunViews,
  listWorkflowRuns,
  resumeWaitingWorkflowRuns,
  toggleWorkflow,
  unenrollRun,
  workflowsForViewer,
} from '@/lib/crm-workflows';
import {
  BACKFILL_BATCH,
  MAX_BACKFILL_ENROLL,
  MAX_BACKFILL_SCAN,
  MAX_ENROLLMENTS_PER_DAY,
  actionLog,
  compareCondition,
  conditionsReachOtherEntity,
  criteriaChanged,
  criteriaEventTypes,
  eventChangedFields,
} from '@/lib/crm-workflow-rules';
import { triggerStepProblems, workflowProblems } from '@/lib/crm-workflow-catalog';
import { workflowCreateSchema, workflowUpdateSchema } from '@/lib/crm-workflows-schema';
import { createSalesTeam, setMemberVisibility, sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer, setFieldPermissions } from '@/lib/crm-field-perms';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const backfillRoute = await import('@/lib/routes/crm/workflows/[id]/enroll-existing/route');
const unenrollRoute = await import('@/lib/routes/crm/workflows/[id]/enrollments/[runId]/route');
const itemRoute = await import('@/lib/routes/crm/workflows/[id]/route');

beforeEach(() => {
  session.user = null;
});

async function res(p: Promise<Response | undefined>): Promise<Response> {
  const r = await p;
  if (!r) throw new Error('no response');
  return r;
}
const req = (method: string) => new Request('http://x/api/crm/workflows', { method });
async function runs(ws: string, wf: string) {
  return listWorkflowRuns(ws, wf, 500);
}
async function tasksFor(ws: string, contactId: string) {
  return (await getDb()
    .prepare("SELECT subject FROM crm_activities WHERE user_id = ? AND contact_id = ? AND type = 'task'")
    .all(ws, contactId)) as Array<{ subject: string }>;
}
async function expireAll(ws: string) {
  await getDb().prepare("UPDATE crm_workflow_runs SET resume_at = '2000-01-01 00:00:00' WHERE user_id = ? AND status = 'waiting'").run(ws);
}
const inRosario = { entity: 'contact' as const, field: 'city', op: 'equals' as const, value: 'Rosario' };
const criteria = (entity: 'contact' | 'company' | 'deal' = 'contact') => [{ type: 'criteria_met' as const, config: { entity } }];

describe('W3: reglas puras', () => {
  it('criterios: eventos que los revisan y qué cambio reinscribe', () => {
    expect(criteriaEventTypes('contact')).toEqual(['contact_created', 'contact_updated']);
    expect(criteriaEventTypes('deal')).toContain('deal_stage_changed');
    expect(eventChangedFields('deal_stage_changed', {})).toEqual(['stage_id']);
    expect(criteriaChanged([inRosario], 'contact', ['city'])).toBe(true);
    expect(criteriaChanged([inRosario], 'contact', ['job_title'])).toBe(false);
    // Un criterio sobre otra entidad no cuenta como cambio del registro.
    expect(criteriaChanged([{ ...inRosario, entity: 'company' }], 'contact', ['city'])).toBe(false);
    expect(criteriaChanged([{ entity: 'contact', field: 'custom.tier', op: 'is_set' }], 'contact', ['custom.tier'])).toBe(true);
  });

  it('compareCondition: mismas reglas que si/si no', () => {
    expect(compareCondition('Rosario', 'equals', 'rosario')).toBe(true);
    expect(compareCondition('', 'is_not_set', undefined)).toBe(true);
    expect(compareCondition('120', 'gt', '100')).toBe(true);
    expect(compareCondition('', 'gt', '1')).toBe(false);
    expect(compareCondition('Gold plan', 'contains', 'gold')).toBe(true);
  });

  it('el registro por acción no lleva valores ni texto libre de errores', () => {
    const log = actionLog([
      { ok: true, type: 'update_field', result: { field: 'custom.salary', value: '999' }, at: '2026-11-22 10:00:00', position: 0 },
      { ok: true, type: 'branch', result: { branch: 'no' } },
      { ok: true, type: 'create_task', result: { skipped: true } },
      { ok: true, type: 'delay', result: { minutes: 60 } },
      { ok: false, type: 'webhook', error: 'connect ECONNREFUSED secret.example.test' },
      { ok: false, type: 'send_email', error: 'missing_recipient' },
      { ok: true, type: 'ai_step', result: { text: 'private summary' } },
    ]);
    expect(log.map((l) => l.outcome)).toEqual(['ok', 'ok', 'skipped', 'waited', 'failed', 'failed', 'ok']);
    expect(log[1].branch).toBe('no');
    expect(log[3].minutes).toBe(60);
    expect(log[4].error).toBe('action_error');
    expect(log[5].error).toBe('missing_recipient');
    const json = JSON.stringify(log);
    for (const leak of ['999', 'salary', 'secret.example', 'private summary']) expect(json).not.toContain(leak);
    expect(actionLog('nope')).toEqual([]);
  });

  it('criterios sobre otra entidad (filtros o ramas) se detectan', () => {
    const base = { settings: { filters: [inRosario] }, actions: [] as Array<{ type: string; config: Record<string, unknown> }> };
    expect(conditionsReachOtherEntity(base, 'contact')).toBe(false);
    expect(conditionsReachOtherEntity({ ...base, settings: { filters: [{ ...inRosario, entity: 'company' }] } }, 'contact')).toBe(true);
    expect(conditionsReachOtherEntity({ ...base, actions: [{ type: 'branch', config: { entity: 'deal', field: 'amount' } }] }, 'contact')).toBe(true);
  });

  it('"cumple los criterios" sin criterios no se guarda (editor y API)', () => {
    expect(triggerStepProblems(criteria(), { filters: [] })).toEqual(['criteria']);
    expect(triggerStepProblems(criteria(), { filters: [inRosario] })).toEqual([]);
    expect(triggerStepProblems([{ type: 'contact_created' }], {})).toEqual([]);
    expect(workflowProblems({ name: 'x', triggers: criteria(), actions: [{ type: 'create_task', config: { subject: 's' } }], settings: {} })).toContain('criteria');
    const body = { name: 'C', triggers: criteria(), actions: [{ type: 'create_task', config: { subject: 's' } }] };
    expect(workflowCreateSchema.safeParse(body).success).toBe(false);
    expect(workflowCreateSchema.safeParse({ ...body, settings: { filters: [inRosario] } }).success).toBe(true);
    expect(workflowUpdateSchema.safeParse({ triggers: criteria(), settings: { filters: [] } }).success).toBe(false);
    // Un PATCH sin settings conserva los criterios guardados.
    expect(workflowUpdateSchema.safeParse({ triggers: criteria() }).success).toBe(true);
  });
});

describe('W3: inscripción por criterios', () => {
  it('entra cuando el registro empieza a cumplir; sin reinscripción, una sola vez', async () => {
    const a = await makeUser('w3-crit');
    const wf = await createWorkflow(a.id, {
      name: 'Rosario',
      settings: { reenroll: false, filters: [inRosario] },
      triggers: criteria(),
      actions: [{ type: 'create_task', config: { subject: 'Call' } }],
    });
    const c = await createContact(a.id, { email: 'crit@w3.test', city: 'Córdoba' });
    expect(await runs(a.id, wf.id)).toHaveLength(0);
    await updateContact(a.id, c.id, { city: 'Rosario' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    await updateContact(a.id, c.id, { jobTitle: 'CEO' });
    await updateContact(a.id, c.id, { city: 'Córdoba' });
    await updateContact(a.id, c.id, { city: 'Rosario' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    expect((await tasksFor(a.id, c.id)).map((t) => t.subject)).toEqual(['Call']);
    // Creado ya cumpliendo: entra al crearse.
    const d = await createContact(a.id, { email: 'crit2@w3.test', city: 'Rosario' });
    expect((await runs(a.id, wf.id)).filter((r) => r.trigger_entity_id === d.id)).toHaveLength(1);
  });

  it('con reinscripción vuelve a entrar solo si cambia una propiedad de los criterios, con el tope diario', async () => {
    const a = await makeUser('w3-reenroll');
    const wf = await createWorkflow(a.id, {
      name: 'Gold',
      settings: { reenroll: true, filters: [{ entity: 'contact', field: 'job_title', op: 'contains', value: 'gold' }] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const c = await createContact(a.id, { email: 're@w3.test', jobTitle: 'gold 0' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    await updateContact(a.id, c.id, { city: 'Elsewhere' }); // otra propiedad: no
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    for (let i = 1; i < MAX_ENROLLMENTS_PER_DAY + 4; i++) await updateContact(a.id, c.id, { jobTitle: `gold ${i}` });
    expect(await runs(a.id, wf.id)).toHaveLength(MAX_ENROLLMENTS_PER_DAY);
  });

  it('sin criterios no inscribe nada; empresas y cambios de etapa de deals también', async () => {
    const a = await makeUser('w3-entities');
    const empty = await createWorkflow(a.id, { name: 'Empty', triggers: criteria(), actions: [{ type: 'create_task', config: { subject: 'x' } }] });
    await createContact(a.id, { email: 'empty@w3.test' });
    expect(await runs(a.id, empty.id)).toHaveLength(0);

    const co = await createWorkflow(a.id, {
      name: 'Big companies',
      settings: { filters: [{ entity: 'company', field: 'domain', op: 'contains', value: 'big' }] },
      triggers: criteria('company'),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    await createCompany(a.id, { name: 'Small', domain: 'small.test' });
    await createCompany(a.id, { name: 'Big', domain: 'big.test' });
    expect(await runs(a.id, co.id)).toHaveLength(1);

    const p = await createPipeline(a.id, 'Sales');
    const s1 = (await createStage(a.id, p.id, { name: 'New' })) as { id: string };
    const s2 = (await createStage(a.id, p.id, { name: 'Demo' })) as { id: string };
    const dw = await createWorkflow(a.id, {
      name: 'Demo stage',
      settings: { filters: [{ entity: 'deal', field: 'stage_id', op: 'equals', value: s2.id }] },
      triggers: criteria('deal'),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const deal = await createDeal(a.id, { name: 'D', pipelineId: p.id, stageId: s1.id });
    if (!deal.ok) throw new Error('deal');
    expect(await runs(a.id, dw.id)).toHaveLength(0);
    await moveDeal(a.id, deal.deal.id, s2.id);
    expect(await runs(a.id, dw.id)).toHaveLength(1);
  });

  it('un workflow por criterios que cambia su propio criterio no entra en loop', async () => {
    const a = await makeUser('w3-loop');
    const wf = await createWorkflow(a.id, {
      name: 'Self',
      settings: { reenroll: true, filters: [{ entity: 'contact', field: 'job_title', op: 'is_set' }] },
      triggers: criteria(),
      actions: [{ type: 'update_field', config: { entity: 'contact', field: 'job_title', value: 'changed' } }],
    });
    const c = await createContact(a.id, { email: 'loop@w3.test' });
    await updateContact(a.id, c.id, { jobTitle: 'x' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
  });
});

describe('W3: inscribir los registros que ya cumplen', () => {
  it('inscribe los que cumplen (también con criterios sobre la empresa), los corre por cron y no duplica', async () => {
    const a = await makeUser('w3-backfill');
    const acme = await createCompany(a.id, { name: 'Acme', domain: 'acme.test' });
    const yes1 = await createContact(a.id, { email: 'y1@w3.test', city: 'Rosario', companyId: acme.id });
    const yes2 = await createContact(a.id, { email: 'y2@w3.test', city: 'Rosario', companyId: acme.id });
    const noCompany = await createContact(a.id, { email: 'n1@w3.test', city: 'Rosario' });
    await createContact(a.id, { email: 'n2@w3.test', city: 'Córdoba', companyId: acme.id });
    const wf = await createWorkflow(a.id, {
      name: 'Acme in Rosario',
      settings: { filters: [inRosario, { entity: 'company', field: 'domain', op: 'equals', value: 'acme.test' }] },
      triggers: criteria(),
      actions: [{ type: 'create_task', config: { subject: 'Backfilled' } }],
    });
    expect(await runs(a.id, wf.id)).toHaveLength(0);
    const out = await enrollExistingRecords(a.id, wf.id);
    expect(out).toEqual({ checked: 4, enrolled: 2, capped: false });
    const queued = await runs(a.id, wf.id);
    expect(queued.map((r) => r.status)).toEqual(['waiting', 'waiting']);
    expect(new Set(queued.map((r) => r.trigger_entity_id))).toEqual(new Set([yes1.id, yes2.id]));
    // La pasada no corre acciones: las corre el cron.
    expect(await tasksFor(a.id, yes1.id)).toHaveLength(0);
    await resumeWaitingWorkflowRuns();
    expect((await runs(a.id, wf.id)).map((r) => r.status)).toEqual(['done', 'done']);
    expect((await tasksFor(a.id, yes2.id)).map((t) => t.subject)).toEqual(['Backfilled']);
    expect(await tasksFor(a.id, noCompany.id)).toHaveLength(0);
    // Otra pasada no vuelve a inscribir a nadie, aunque tenga reinscripción.
    expect((await enrollExistingRecords(a.id, wf.id))?.enrolled).toBe(0);
    // Apagado: no inscribe.
    await toggleWorkflow(a.id, wf.id, false);
    expect((await enrollExistingRecords(a.id, wf.id))?.enrolled).toBe(0);
  });

  it(`tope de ${MAX_BACKFILL_ENROLL} por pasada y de a ${BACKFILL_BATCH} por minuto`, async () => {
    const a = await makeUser('w3-cap');
    const db = getDb();
    const total = MAX_BACKFILL_ENROLL + 20;
    for (let i = 0; i < total; i += 100) {
      const n = Math.min(100, total - i);
      const values = Array.from({ length: n }, () => "(?, ?, 'Rosario')").join(',');
      const args = Array.from({ length: n }, () => [crypto.randomUUID(), a.id]).flat();
      await db.prepare(`INSERT INTO crm_contacts (id, user_id, city) VALUES ${values}`).run(...args);
    }
    const wf = await createWorkflow(a.id, {
      name: 'Cap',
      settings: { filters: [inRosario] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const out = await enrollExistingRecords(a.id, wf.id);
    expect(out?.enrolled).toBe(MAX_BACKFILL_ENROLL);
    expect(out?.capped).toBe(true);
    const due = (await db
      .prepare("SELECT COUNT(*) AS n FROM crm_workflow_runs WHERE workflow_id = ? AND status = 'waiting' AND resume_at <= datetime('now')")
      .get(wf.id)) as { n: number };
    expect(due.n).toBe(BACKFILL_BATCH);
    // Con 500 esperando su primer turno en el workspace, otra pasada no agrega más.
    const busy = await enrollExistingRecords(a.id, wf.id, out?.next);
    expect(busy).toMatchObject({ enrolled: 0, busy: true });
    // Cuando arrancan, la pasada siguiente sigue con el resto desde el cursor.
    await db.prepare("UPDATE crm_workflow_runs SET status = 'done', steps = 1 WHERE workflow_id = ?").run(wf.id);
    expect((await enrollExistingRecords(a.id, wf.id, out?.next))?.enrolled).toBe(20);
  });

  it(`si los ${MAX_BACKFILL_SCAN} más nuevos no cumplen, la pasada siguiente sigue desde el cursor`, async () => {
    const a = await makeUser('w3-cursor');
    const db = getDb();
    const insert = async (n: number, city: string, created: string) => {
      for (let i = 0; i < n; i += 200) {
        const k = Math.min(200, n - i);
        const values = Array.from({ length: k }, () => '(?, ?, ?, ?)').join(',');
        const args = Array.from({ length: k }, () => [crypto.randomUUID(), a.id, city, created]).flat();
        await db.prepare(`INSERT INTO crm_contacts (id, user_id, city, created_at) VALUES ${values}`).run(...args);
      }
    };
    await insert(3, 'Rosario', '2020-01-01 00:00:00');
    await insert(MAX_BACKFILL_SCAN + 10, 'Córdoba', '2026-01-01 00:00:00');
    const wf = await createWorkflow(a.id, {
      name: 'Old ones',
      settings: { filters: [inRosario] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const first = await enrollExistingRecords(a.id, wf.id);
    expect(first).toMatchObject({ checked: MAX_BACKFILL_SCAN, enrolled: 0, capped: true });
    expect(first?.next?.entity).toBe('contact');
    const second = await enrollExistingRecords(a.id, wf.id, first?.next);
    expect(second).toMatchObject({ enrolled: 3, capped: false });
  });
});

describe('W3: sacar a mano', () => {
  it('una inscripción que espera termina como sacada, el cron no la retoma y no vuelve a entrar', async () => {
    const a = await makeUser('w3-unenroll');
    const wf = await createWorkflow(a.id, {
      name: 'Nurture',
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'delay', config: { amount: 1, unit: 'days' } },
        { type: 'create_task', config: { subject: 'Later' } },
      ],
    });
    const c = await createContact(a.id, { email: 'out@w3.test' });
    const [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('waiting');
    expect(await unenrollRun(a.id, wf.id, run.id, a.id)).toBe(true);
    // Ya terminó: una segunda vez no cambia nada.
    expect(await unenrollRun(a.id, wf.id, run.id, a.id)).toBe(false);
    await expireAll(a.id);
    await resumeWaitingWorkflowRuns();
    const [after] = await runs(a.id, wf.id);
    expect(after.status).toBe('unenrolled');
    expect(after.unenrolled_by).toBe(a.id);
    expect(await tasksFor(a.id, c.id)).toHaveLength(0);
    await updateContact(a.id, c.id, { city: 'X' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
  });
});

describe('W3: privacidad y permisos', () => {
  it('solo owner y admins inscriben los que ya cumplen o sacan registros; otro workspace no encuentra nada', async () => {
    const w = await workspaceWithMember('w3-perm');
    const team = await createSalesTeam(w.owner.id, { name: 'Ventas', members: [w.member.id] });
    void team;
    const wf = await createWorkflow(w.owner.id, {
      name: 'Perm',
      settings: { filters: [inRosario] },
      triggers: criteria(),
      actions: [
        { type: 'delay', config: { amount: 1, unit: 'days' } },
        { type: 'create_task', config: { subject: 'x' } },
      ],
    });
    await createContact(w.owner.id, { email: 'perm@w3.test', city: 'Rosario' });
    const [run] = await runs(w.owner.id, wf.id);
    const p = { params: Promise.resolve({ id: wf.id }) };
    const pr = { params: Promise.resolve({ id: wf.id, runId: run.id }) };

    session.user = null;
    expect((await res(backfillRoute.POST(req('POST'), p))).status).toBe(401);
    expect((await res(unenrollRoute.DELETE(req('DELETE'), pr))).status).toBe(401);
    // Miembro (y miembro de un equipo de ventas): no.
    session.user = asMember(w.owner, w.member);
    expect((await res(backfillRoute.POST(req('POST'), p))).status).toBe(403);
    expect((await res(unenrollRoute.DELETE(req('DELETE'), pr))).status).toBe(403);
    // Otro workspace: no existe.
    session.user = asOwner(w.stranger);
    expect((await res(backfillRoute.POST(req('POST'), p))).status).toBe(404);
    expect((await res(unenrollRoute.DELETE(req('DELETE'), pr))).status).toBe(404);
    expect((await runs(w.owner.id, wf.id))[0].status).toBe('waiting');
    // Admin y owner: sí.
    session.user = asMember(w.owner, w.friend, 'admin');
    expect((await res(backfillRoute.POST(req('POST'), p))).status).toBe(200);
    expect((await res(unenrollRoute.DELETE(req('DELETE'), pr))).status).toBe(204);
    session.user = asOwner(w.owner);
    expect((await res(unenrollRoute.DELETE(req('DELETE'), pr))).status).toBe(404);
    expect((await res(backfillRoute.POST(req('POST'), p))).status).toBe(200);
    // Un PATCH que deja "cumple los criterios" sin criterios no se guarda (contra lo guardado).
    const patch = (body: unknown) =>
      itemRoute.PATCH(new NextRequest('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), p);
    expect((await res(patch({ settings: { filters: [] } }))).status).toBe(400);
    expect((await res(patch({ name: 'Renamed' }))).status).toBe(200);
  });

  it('el registro por acción es solo para owner y admins, sin valores; un miembro no lo recibe', async () => {
    const w = await workspaceWithMember('w3-log');
    await setMemberVisibility(w.owner.id, 'mine');
    const wf = await createWorkflow(w.owner.id, {
      name: 'Log',
      triggers: [{ type: 'contact_created' }],
      actions: [
        // Un valor que no puede salir por casualidad en un id (UUID en hex) ni en una fecha: si aparece, se filtró.
        { type: 'update_field', config: { entity: 'contact', field: 'job_title', value: 'Secret title QZXW' } },
        { type: 'branch', config: { entity: 'contact', field: 'city', op: 'equals', value: 'Rosario' } },
        { type: 'create_task', config: { subject: 'Yes path', when: 'yes' } },
      ],
    });
    await createContact(w.owner.id, { email: 'log@w3.test', ownerId: w.member.id, city: 'Córdoba' });
    const [admin] = await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(asOwner(w.owner)), 20, { log: true });
    expect(admin.log?.map((l) => [l.type, l.outcome, l.branch ?? null])).toEqual([
      ['update_field', 'ok', null],
      ['branch', 'ok', 'no'],
      ['create_task', 'skipped', null],
    ]);
    expect(JSON.stringify(admin)).not.toContain('QZXW');
    expect(JSON.stringify(admin)).not.toContain('Secret title');
    // Un miembro, aunque alguien pida el registro, no lo recibe.
    const memberViews = await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(asMember(w.owner, w.member)), 20, { log: true });
    expect(memberViews).toHaveLength(1);
    expect(memberViews[0].log).toBeUndefined();
    expect(JSON.stringify(memberViews)).not.toContain('branch');
  });

  it('un miembro con "mine" o de un equipo de ventas no ve inscripciones cuyos criterios miran otro registro', async () => {
    const w = await workspaceWithMember('w3-cross');
    await setMemberVisibility(w.owner.id, 'team');
    await createSalesTeam(w.owner.id, { name: 'Ventas', members: [w.member.id, w.friend.id] });
    const outsider = await makeUser('w3-cross-outsider');
    const { addMember } = await import('@/lib/teams');
    await addMember(w.team.id, outsider.id, 'member');
    // La empresa es de alguien fuera del equipo: el miembro no la ve.
    const secret = await createCompany(w.owner.id, { name: 'Hidden Co', domain: 'whale.test', ownerId: outsider.id });
    const own = await createWorkflow(w.owner.id, {
      name: 'Own criteria',
      settings: { filters: [inRosario] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const cross = await createWorkflow(w.owner.id, {
      name: 'Whale company',
      settings: { filters: [inRosario, { entity: 'company', field: 'domain', op: 'equals', value: 'whale.test' }] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const mine = await createContact(w.owner.id, { email: 'teammate@w3.test', city: 'Rosario', ownerId: w.friend.id, companyId: secret.id });
    const notMine = await createContact(w.owner.id, { email: 'outsider@w3.test', city: 'Rosario', ownerId: outsider.id });
    const member = asMember(w.owner, w.member);
    const scope = await sessionScope(member);
    // Criterios sobre el propio registro: ve la del compañero de equipo, no la de afuera.
    expect((await listWorkflowRunViews(w.owner.id, own.id, scope)).map((v) => v.record?.id)).toEqual([mine.id]);
    expect((await listWorkflowRunViews(w.owner.id, own.id, scope)).map((v) => v.record?.id)).not.toContain(notMine.id);
    // Criterios sobre la empresa (que no ve): ninguna.
    expect(await listWorkflowRunViews(w.owner.id, cross.id, scope)).toEqual([]);
    const card = await listRecordEnrollments(w.owner.id, 'contact', mine.id, 20, sessionFieldViewer(member));
    expect(card.map((e) => e.workflow_name)).toEqual(['Own criteria']);
    // Owner ve las dos.
    const ownerCard = await listRecordEnrollments(w.owner.id, 'contact', mine.id, 20, sessionFieldViewer(asOwner(w.owner)));
    expect(ownerCard.map((e) => e.workflow_name).sort()).toEqual(['Own criteria', 'Whale company']);
  });

  it('criterios sobre un campo oculto: el miembro no ve el workflow ni las inscripciones', async () => {
    const w = await workspaceWithMember('w3-hidden');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'text' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: 'role:member', access: 'hidden' }]);
    const wf = await createWorkflow(w.owner.id, {
      name: 'High salary',
      settings: { filters: [{ entity: 'contact', field: 'custom.salary', op: 'gt', value: '100000' }] },
      triggers: criteria(),
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const c = await createContact(w.owner.id, { email: 'rich@w3.test', custom: { salary: '200000' } });
    expect(await runs(w.owner.id, wf.id)).toHaveLength(1);
    const member = asMember(w.owner, w.member);
    expect(await workflowsForViewer(sessionFieldViewer(member), [wf])).toEqual([]);
    expect(await listRecordEnrollments(w.owner.id, 'contact', c.id, 20, sessionFieldViewer(member))).toEqual([]);
    expect(await listRecordEnrollments(w.owner.id, 'contact', c.id, 20, sessionFieldViewer(asMember(w.owner, w.friend, 'admin')))).toHaveLength(1);
  });
});
