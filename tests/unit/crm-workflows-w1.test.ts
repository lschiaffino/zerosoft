/**
 * CRM, bloque W1 (workflows como HubSpot): reinscripción, filtros de
 * inscripción, "propiedad cambiada", esperas que se retoman por cron (y
 * quedan en pausa con el workflow apagado), tope por corrida, empresas,
 * rotar owner, crear deal, quitar de lista, avisos que respetan lo que cada
 * persona ve, historial filtrado y webhooks firmados sin campos ocultos.
 */
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCompany,
  createContact,
  createCustomField,
  createList,
  addListMembers,
  createPipeline,
  createStage,
  updateCompany,
  updateContact,
} from '@/lib/crm';
import {
  createWorkflow,
  listRecordEnrollments,
  listWorkflowRunViews,
  listWorkflowRuns,
  resumeWaitingWorkflowRuns,
  toggleWorkflow,
  workflowWebhookSecret,
} from '@/lib/crm-workflows';
import {
  MAX_ENROLLMENTS_PER_DAY,
  MAX_RUN_STEPS,
  changedFields,
  delayMinutes,
  parseWorkflowSettings,
  pickRotation,
  propertyChangeMatches,
  redactActionsForMember,
  safeWebhookHeaders,
  webhookBody,
} from '@/lib/crm-workflow-rules';
import { actionMissing } from '@/lib/crm-workflow-catalog';
import { setMemberVisibility, sessionScope } from '@/lib/crm-visibility';
import { setFieldPermissions } from '@/lib/crm-field-perms';
import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const fetches = vi.hoisted(() => ({ calls: [] as Array<{ url: string; init: RequestInit }> }));
vi.mock('@/lib/safe-fetch', async (orig) => ({
  ...((await orig()) as object),
  safeFetch: async (url: string, init: RequestInit) => {
    fetches.calls.push({ url, init });
    return new Response('ok', { status: 200 });
  },
}));

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const listRoute = await import('@/app/api/crm/workflows/route');
const itemRoute = await import('@/lib/routes/crm/workflows/[id]/route');
const toggleRoute = await import('@/lib/routes/crm/workflows/[id]/toggle/route');

beforeEach(() => {
  session.user = null;
  fetches.calls = [];
});

async function res(p: Promise<Response | undefined>): Promise<Response> {
  const r = await p;
  if (!r) throw new Error('no response');
  return r;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/api/crm/workflows', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function runs(ws: string, wf: string) {
  return listWorkflowRuns(ws, wf, 200);
}
async function tasksFor(ws: string, contactId: string) {
  return (await getDb()
    .prepare("SELECT subject FROM crm_activities WHERE user_id = ? AND contact_id = ? AND type = 'task'")
    .all(ws, contactId)) as Array<{ subject: string }>;
}
/** Adelanta la espera de una corrida (en vez de esperar de verdad). */
async function expireWait(runId: string) {
  await getDb().prepare("UPDATE crm_workflow_runs SET resume_at = '2000-01-01 00:00:00' WHERE id = ?").run(runId);
}

describe('W1: reglas puras', () => {
  it('los workflows de antes (sin settings) siguen reinscribiendo; los ajustes se normalizan', () => {
    expect(parseWorkflowSettings('{}')).toEqual({ reenroll: true, filters: [] });
    expect(parseWorkflowSettings('nope')).toEqual({ reenroll: true, filters: [] });
    const s = parseWorkflowSettings({ reenroll: false, filters: [{ entity: 'x', field: ' city ', op: 'weird', value: 'A' }, { field: '' }] });
    expect(s).toEqual({ reenroll: false, filters: [{ entity: 'contact', field: 'city', op: 'equals', value: 'A' }] });
  });

  it('changedFields solo cuenta lo que cambió, custom por clave', () => {
    const existing = { city: 'Rosario', lifecycle_stage: 'lead', custom: JSON.stringify({ a: 1, b: 'x' }) };
    expect(
      changedFields(existing, [
        ['city', 'Rosario'],
        ['lifecycle_stage', 'customer'],
        ['custom', JSON.stringify({ a: 1, b: 'y', c: 'new' })],
      ]),
    ).toEqual(['lifecycle_stage', 'custom.b', 'custom.c']);
    expect(changedFields({ amount: 100 }, [['amount', '100']])).toEqual([]);
  });

  it('propiedad cambiada: camelCase o snake_case, y sin propiedad cualquier cambio', () => {
    expect(propertyChangeMatches({}, undefined)).toBe(true);
    expect(propertyChangeMatches({ field: 'lifecycleStage' }, { changed: ['lifecycle_stage'] })).toBe(true);
    expect(propertyChangeMatches({ field: 'custom.tier' }, { changed: ['custom.tier'] })).toBe(true);
    expect(propertyChangeMatches({ field: 'city' }, { changed: ['lifecycle_stage'] })).toBe(false);
    expect(propertyChangeMatches({ field: 'city' }, undefined)).toBe(false);
  });

  it('esperas: unidades, mínimo 1 minuto y tope de 30 días', () => {
    expect(delayMinutes({ amount: 2, unit: 'hours' })).toBe(120);
    expect(delayMinutes({ amount: 0.001, unit: 'minutes' })).toBe(1);
    expect(delayMinutes({ amount: 400, unit: 'days' })).toBe(60 * 24 * 30);
    expect(delayMinutes({ amount: 0 })).toBeNull();
    expect(delayMinutes({ amount: 'x' })).toBeNull();
    expect(actionMissing('delay', { amount: 0 })).toEqual(['amount']);
    expect(actionMissing('rotate_owner', { ownerIds: [] })).toEqual(['ownerIds']);
    expect(actionMissing('notify_user', { message: 'hi', recipients: 'people' })).toEqual(['userIds']);
  });

  it('rotación: sigue el orden, saltea a quien no está y vuelve al principio', () => {
    expect(pickRotation(['a', 'b', 'c'], 0, new Set())).toEqual({ owner: 'a', next: 1 });
    expect(pickRotation(['a', 'b', 'c'], 1, new Set(['b']))).toEqual({ owner: 'c', next: 0 });
    expect(pickRotation(['a', 'b'], 7, new Set())).toEqual({ owner: 'b', next: 0 });
    expect(pickRotation(['a'], 0, new Set(['a']))).toBeNull();
    expect(pickRotation([], 0, new Set())).toBeNull();
  });

  it('el cuerpo del webhook no lleva campos ocultos, ni respuestas de formularios, ni el nombre del campo oculto', () => {
    const body = JSON.parse(
      webhookBody({
        workflowId: 'w',
        runId: 'r',
        event: { type: 'contact_updated', entity: 'contact', entityId: 'c1', payload: { changed: ['city', 'custom.salary'], answers: { q: 'secret' } } },
        records: { contact: { id: 'c1', email: 'a@b.test', user_id: 'ws', custom: JSON.stringify({ salary: 99, tier: 'gold' }) } },
        hidden: { contact: new Set(['salary']) },
      }),
    );
    expect(body.contact).toEqual({ id: 'c1', email: 'a@b.test', custom: { tier: 'gold' } });
    expect(body.event.payload).toEqual({ changed: ['city'] });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('user_id');
  });

  it('las cabeceras del webhook no pueden pisar la firma; un miembro no ve cabeceras ni la URL completa', () => {
    const h = safeWebhookHeaders({ 'Zerosoft-Signature': 'forged', Authorization: 'Bearer x', 'bad header': 'y' });
    expect(h).toEqual({ 'content-type': 'application/json', authorization: 'Bearer x' });
    const [a] = redactActionsForMember([
      { type: 'webhook', config: { url: 'https://hooks.example.test/path?token=abc', method: 'POST', headers: { authorization: 'Bearer x' } } },
    ]);
    expect(a.config).toEqual({ method: 'POST', url: 'https://hooks.example.test', when: undefined });
  });
});

describe('W1: inscripción y loops', () => {
  it('sin reinscripción un registro entra una sola vez', async () => {
    const a = await makeUser('w1-once');
    const wf = await createWorkflow(a.id, {
      name: 'Once',
      settings: { reenroll: false },
      triggers: [{ type: 'contact_updated' }],
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const c = await createContact(a.id, { email: 'once@w1.test' });
    await updateContact(a.id, c.id, { city: 'A' });
    await updateContact(a.id, c.id, { city: 'B' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
  });

  it(`con reinscripción hay un tope de ${MAX_ENROLLMENTS_PER_DAY} por registro en 24 horas`, async () => {
    const a = await makeUser('w1-cap');
    const wf = await createWorkflow(a.id, {
      name: 'Cap',
      settings: { reenroll: true },
      triggers: [{ type: 'contact_updated' }],
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const c = await createContact(a.id, { email: 'cap@w1.test' });
    for (let i = 0; i < MAX_ENROLLMENTS_PER_DAY + 3; i++) await updateContact(a.id, c.id, { city: `C${i}` });
    expect(await runs(a.id, wf.id)).toHaveLength(MAX_ENROLLMENTS_PER_DAY);
  });

  it(`una inscripción corre como mucho ${MAX_RUN_STEPS} acciones`, async () => {
    const a = await makeUser('w1-steps');
    const wf = await createWorkflow(a.id, {
      name: 'Steps',
      triggers: [{ type: 'contact_created' }],
      actions: Array.from({ length: MAX_RUN_STEPS + 5 }, (_, i) => ({ type: 'create_activity' as const, config: { type: 'note', subject: `s${i}` } })),
    });
    await createContact(a.id, { email: 'steps@w1.test' });
    const [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('failed');
    const out = JSON.parse(run.output) as { results: Array<{ ok: boolean; error?: string }> };
    expect(out.results.filter((r) => r.ok)).toHaveLength(MAX_RUN_STEPS);
    expect(out.results.at(-1)?.error).toBe('step_cap');
  });

  it('un workflow que se reactualiza a sí mismo con reinscripción no entra en loop', async () => {
    const a = await makeUser('w1-loop');
    const wf = await createWorkflow(a.id, {
      name: 'Self',
      settings: { reenroll: true },
      triggers: [{ type: 'contact_updated' }],
      actions: [{ type: 'update_field', config: { entity: 'contact', field: 'job_title', value: 'x' } }],
    });
    const c = await createContact(a.id, { email: 'loop@w1.test' });
    await updateContact(a.id, c.id, { city: 'A' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
  });

  it('filtros de inscripción y "propiedad cambiada" con valor nuevo', async () => {
    const a = await makeUser('w1-filter');
    const wf = await createWorkflow(a.id, {
      name: 'Customers in Rosario',
      settings: { reenroll: true, filters: [{ entity: 'contact', field: 'city', op: 'equals', value: 'Rosario' }] },
      triggers: [{ type: 'contact_updated', config: { field: 'lifecycle_stage', value: 'customer' } }],
      actions: [{ type: 'create_task', config: { subject: 'Kickoff' } }],
    });
    const c = await createContact(a.id, { email: 'filter@w1.test', city: 'Córdoba' });
    await updateContact(a.id, c.id, { lifecycleStage: 'customer' }); // no cumple el filtro
    await updateContact(a.id, c.id, { city: 'Rosario' }); // no cambia la etapa
    expect(await runs(a.id, wf.id)).toHaveLength(0);
    await updateContact(a.id, c.id, { lifecycleStage: 'lead' });
    await updateContact(a.id, c.id, { lifecycleStage: 'customer' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    expect((await tasksFor(a.id, c.id)).map((t) => t.subject)).toEqual(['Kickoff']);
  });
});

describe('W1: esperas', () => {
  it('una espera deja la inscripción esperando y el cron la retoma; apagado, queda en pausa sin perder el estado', async () => {
    const a = await makeUser('w1-delay');
    const wf = await createWorkflow(a.id, {
      name: 'Follow up',
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'create_task', config: { subject: 'First' } },
        { type: 'delay', config: { amount: 2, unit: 'days' } },
        { type: 'create_task', config: { subject: 'Second' } },
      ],
    });
    const c = await createContact(a.id, { email: 'delay@w1.test' });
    let [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('waiting');
    expect((await tasksFor(a.id, c.id)).map((t) => t.subject)).toEqual(['First']);

    // Mientras espera, el mismo registro no se vuelve a inscribir.
    await updateContact(a.id, c.id, { city: 'X' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);

    // Todavía no venció: el cron no la toca.
    await resumeWaitingWorkflowRuns();
    expect((await runs(a.id, wf.id))[0].status).toBe('waiting');

    // Apagado: venció, pero queda esperando.
    await expireWait(run.id);
    await toggleWorkflow(a.id, wf.id, false);
    await resumeWaitingWorkflowRuns();
    expect((await runs(a.id, wf.id))[0].status).toBe('waiting');
    expect(await tasksFor(a.id, c.id)).toHaveLength(1);

    // Prendido otra vez: sigue desde la acción después de la espera, una sola vez.
    await toggleWorkflow(a.id, wf.id, true);
    await Promise.all([resumeWaitingWorkflowRuns(), resumeWaitingWorkflowRuns()]);
    [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('done');
    expect((await tasksFor(a.id, c.id)).map((t) => t.subject).sort()).toEqual(['First', 'Second']);
    const out = JSON.parse(run.output) as { results: Array<{ type: string }> };
    expect(out.results.map((r) => r.type)).toEqual(['create_task', 'delay', 'create_task']);
  });

  it('dos workflows con espera que crean deals entre sí no hacen ping-pong después de retomar', async () => {
    const a = await makeUser('w1-pingpong');
    const p = await createPipeline(a.id, 'Sales');
    const s = (await createStage(a.id, p.id, { name: 'New' })) as { id: string };
    const make = (name: string) =>
      createWorkflow(a.id, {
        name,
        settings: { reenroll: true },
        triggers: [{ type: 'deal_created' }],
        actions: [
          { type: 'delay', config: { amount: 1, unit: 'minutes' } },
          { type: 'create_deal', config: { name: `From ${name}`, pipelineId: p.id, stageId: s.id } },
        ],
      });
    await make('A');
    await make('B');
    const countDeals = async () => ((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_deals WHERE user_id = ?').get(a.id)) as { n: number }).n;
    const { createDeal } = await import('@/lib/crm');
    await createDeal(a.id, { name: 'Seed', pipelineId: p.id, stageId: s.id });
    for (let i = 0; i < 4; i++) {
      await getDb().prepare("UPDATE crm_workflow_runs SET resume_at = '2000-01-01 00:00:00' WHERE user_id = ? AND status = 'waiting'").run(a.id);
      await resumeWaitingWorkflowRuns();
    }
    // Seed → A y B esperan y crean un deal cada uno → el otro se inscribe en ese deal (cadena {A, B}),
    // espera y crea uno más → ahí los dos ya están en la cadena y termina: 1 + 2 + 2.
    expect(await countDeals()).toBe(5);
    const waiting = await getDb().prepare("SELECT COUNT(*) AS n FROM crm_workflow_runs WHERE user_id = ? AND status = 'waiting'").get(a.id);
    expect((waiting as { n: number }).n).toBe(0);
  });

  it('cambiar las acciones cierra las inscripciones que esperan; guardar lo mismo no', async () => {
    const a = await makeUser('w1-edit');
    const actions = [
      { type: 'delay' as const, config: { amount: 1, unit: 'days' } },
      { type: 'create_task' as const, config: { subject: 'Later' } },
    ];
    const wf = await createWorkflow(a.id, { name: 'Edit', triggers: [{ type: 'contact_created' }], actions });
    await createContact(a.id, { email: 'edit@w1.test' });
    const { updateWorkflow } = await import('@/lib/crm-workflows');
    await updateWorkflow(a.id, wf.id, { name: 'Edit 2', actions });
    expect((await runs(a.id, wf.id))[0].status).toBe('waiting');
    await updateWorkflow(a.id, wf.id, { actions: [actions[1], actions[0]] });
    expect((await runs(a.id, wf.id))[0].status).toBe('failed');
  });

  it('una corrida colgada en running falla y no bloquea al registro', async () => {
    const a = await makeUser('w1-stuck');
    const wf = await createWorkflow(a.id, {
      name: 'Stuck',
      settings: { reenroll: true },
      triggers: [{ type: 'contact_updated' }],
      actions: [{ type: 'create_activity', config: { type: 'note', subject: 'n' } }],
    });
    const c = await createContact(a.id, { email: 'stuck@w1.test' });
    await updateContact(a.id, c.id, { city: 'A' });
    const [run] = await runs(a.id, wf.id);
    await getDb().prepare("UPDATE crm_workflow_runs SET status = 'running', resume_at = '2000-01-01 00:00:00' WHERE id = ?").run(run.id);
    await resumeWaitingWorkflowRuns();
    expect((await runs(a.id, wf.id))[0].status).toBe('failed');
    await updateContact(a.id, c.id, { city: 'B' });
    expect(await runs(a.id, wf.id)).toHaveLength(2);
  });

  it('si el registro se borra durante la espera, la inscripción termina sin correr nada más', async () => {
    const a = await makeUser('w1-delay-gone');
    const wf = await createWorkflow(a.id, {
      name: 'Gone',
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'delay', config: { amount: 1, unit: 'hours' } },
        { type: 'create_task', config: { subject: 'Never' } },
      ],
    });
    const c = await createContact(a.id, { email: 'gone@w1.test' });
    const [run] = await runs(a.id, wf.id);
    await getDb().prepare('DELETE FROM crm_contacts WHERE id = ?').run(c.id);
    await expireWait(run.id);
    await resumeWaitingWorkflowRuns();
    expect((await runs(a.id, wf.id))[0].status).toBe('done');
    expect(await tasksFor(a.id, c.id)).toHaveLength(0);
  });
});

describe('W1: acciones nuevas y empresas', () => {
  it('empresas: creada y actualizada disparan workflows de empresa', async () => {
    const a = await makeUser('w1-company');
    const wf = await createWorkflow(a.id, {
      name: 'Company',
      settings: { reenroll: true },
      triggers: [{ type: 'company_created' }, { type: 'company_updated', config: { field: 'industry' } }],
      actions: [{ type: 'update_field', config: { entity: 'company', field: 'city', value: 'Lima' } }],
    });
    const co = await createCompany(a.id, { name: 'Acme' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    await updateCompany(a.id, co.id, { phone: '1' });
    expect(await runs(a.id, wf.id)).toHaveLength(1);
    await updateCompany(a.id, co.id, { industry: 'Software' });
    expect(await runs(a.id, wf.id)).toHaveLength(2);
    expect(((await getDb().prepare('SELECT city FROM crm_companies WHERE id = ?').get(co.id)) as { city: string }).city).toBe('Lima');
  });

  it('rotar owner reparte entre el equipo y saltea a quien no es del workspace', async () => {
    const w = await workspaceWithMember('w1-rot');
    const wf = await createWorkflow(w.owner.id, {
      name: 'Rotate',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'rotate_owner', config: { ownerIds: [w.member.id, w.stranger.id, w.friend.id] } }],
    });
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await createContact(w.owner.id, { email: `rot${i}@w1.test` });
      owners.push(((await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(c.id)) as { owner_id: string }).owner_id);
    }
    expect(owners).toEqual([w.member.id, w.friend.id, w.member.id, w.friend.id]);
    expect(await runs(w.owner.id, wf.id)).toHaveLength(4);
  });

  it('crear deal asocia el contacto y quitar de lista lo saca', async () => {
    const a = await makeUser('w1-deal');
    const p = await createPipeline(a.id, 'Sales');
    const s = (await createStage(a.id, p.id, { name: 'New' })) as { id: string };
    const list = await createList(a.id, { name: 'Nurture', kind: 'static' });
    const wf = await createWorkflow(a.id, {
      name: 'MQL',
      triggers: [{ type: 'contact_updated', config: { field: 'lifecycle_stage' } }],
      actions: [
        { type: 'create_deal', config: { name: 'Deal for {{contact.email}}', pipelineId: p.id, stageId: s.id, amount: 500 } },
        { type: 'remove_from_list', config: { listId: list.id } },
      ],
    });
    const c = await createContact(a.id, { email: 'mql@w1.test' });
    await addListMembers(a.id, list.id, [c.id]);
    await updateContact(a.id, c.id, { lifecycleStage: 'marketingqualifiedlead' });
    const [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('done');
    const deal = (await getDb()
      .prepare('SELECT d.name, d.amount FROM crm_deals d JOIN crm_deal_contacts dc ON dc.deal_id = d.id WHERE dc.contact_id = ?')
      .get(c.id)) as { name: string; amount: number };
    expect(deal).toEqual({ name: 'Deal for mql@w1.test', amount: 500 });
    expect(await getDb().prepare('SELECT 1 FROM crm_list_members WHERE list_id = ? AND contact_id = ?').get(list.id, c.id)).toBeUndefined();
  });
});

describe('W1: privacidad', () => {
  async function setup(label: string) {
    const w = await workspaceWithMember(label);
    await setMemberVisibility(w.owner.id, 'mine');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'text' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: 'role:member', access: 'hidden' }]);
    return w;
  }

  it('un aviso llega solo a quien ve el registro y sin los campos que tiene ocultos', async () => {
    const w = await setup('w1-notify');
    await createWorkflow(w.owner.id, {
      name: 'Notify',
      triggers: [{ type: 'contact_created' }],
      actions: [
        {
          type: 'notify_user',
          config: { recipients: 'people', userIds: [w.member.id, w.friend.id, w.stranger.id], message: 'New {{contact.email}} pay={{contact.custom.salary}}' },
        },
      ],
    });
    await createContact(w.owner.id, { email: 'lead@w1.test', ownerId: w.member.id, custom: { salary: '12345' } });
    const notes = (await getDb().prepare("SELECT user_id, body, href FROM notifications WHERE source_type = 'workflow' AND user_id IN (?, ?, ?)").all(
      w.member.id,
      w.friend.id,
      w.stranger.id,
    )) as Array<{ user_id: string; body: string; href: string }>;
    // friend no ve el contacto (visibilidad 'mine') y stranger no es del workspace.
    expect(notes.map((n) => n.user_id)).toEqual([w.member.id]);
    expect(notes[0].body).toContain('lead@w1.test');
    expect(notes[0].body).not.toContain('12345');
    expect(notes[0].href).toMatch(/^\/app\/crm\/contacts\//);
  });

  it('el historial muestra a un miembro solo las inscripciones de registros que ve, sin la salida', async () => {
    const w = await setup('w1-history');
    const wf = await createWorkflow(w.owner.id, {
      name: 'History',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'update_field', config: { entity: 'contact', field: 'custom.salary', value: 'zq-salary-sentinel' } }],
    });
    const mine = await createContact(w.owner.id, { email: 'mine@w1.test', firstName: 'Mine', ownerId: w.member.id });
    await createContact(w.owner.id, { email: 'theirs@w1.test', firstName: 'Theirs', ownerId: w.friend.id });
    const memberScope = await sessionScope(asMember(w.owner, w.member));
    const views = await listWorkflowRunViews(w.owner.id, wf.id, memberScope);
    expect(views.map((v) => v.record?.id)).toEqual([mine.id]);
    // Un centinela con letras fuera de [0-9a-f-]: no puede aparecer en un uuid ni en una fecha.
    expect(JSON.stringify(views)).not.toContain('zq-salary-sentinel');
    expect(JSON.stringify(views)).not.toContain('Theirs');
    // El owner ve las dos.
    expect(await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(asOwner(w.owner)))).toHaveLength(2);
    // Ficha: nombre del workflow, estado y fechas.
    const [e] = await listRecordEnrollments(w.owner.id, 'contact', mine.id);
    expect(e).toMatchObject({ workflow_id: wf.id, workflow_name: 'History', status: 'done' });
    expect(Object.keys(e).sort()).toEqual(['finished_at', 'id', 'resume_at', 'started_at', 'status', 'workflow_id', 'workflow_name']);
  });

  it('el webhook va firmado y sin los campos ocultos', async () => {
    const w = await setup('w1-hook');
    const wf = await createWorkflow(w.owner.id, {
      name: 'Hook',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'webhook', config: { url: 'https://hooks.example.test/in', headers: { 'zerosoft-signature': 'forged', 'x-token': 't' } } }],
    });
    await createContact(w.owner.id, { email: 'hook@w1.test', custom: { salary: 'salary-hidden-777', tier: 'gold' } });
    expect(fetches.calls).toHaveLength(1);
    const { init } = fetches.calls[0];
    const body = String(init.body);
    // Un valor que no aparece por casualidad en un id o una fecha del cuerpo.
    expect(body).not.toContain('salary-hidden-777');
    expect(JSON.parse(body).contact.custom).toEqual({ tier: 'gold' });
    const headers = init.headers as Record<string, string>;
    expect(headers['x-token']).toBe('t');
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers['zerosoft-signature']);
    expect(m).not.toBeNull();
    const secret = (await workflowWebhookSecret(w.owner.id, wf.id))!;
    expect(createHmac('sha256', secret).update(`${m![1]}.${body}`).digest('hex')).toBe(m![2]);
    // El secreto nunca sale con el workflow.
    session.user = asOwner(w.owner);
    const got = await (await res(itemRoute.GET(req('GET'), params(wf.id)))).text();
    expect(got).not.toContain(secret);
    expect(got).not.toContain('webhook_secret');
  });

  it('solo owner y admin crean, editan o apagan workflows; un miembro no ve cabeceras del webhook', async () => {
    const w = await workspaceWithMember('w1-perm');
    const payload = {
      name: 'Perm',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'webhook', config: { url: 'https://hooks.example.test/x?key=abc', headers: { authorization: 'Bearer s3cr3t' } } }],
    };
    session.user = null;
    expect((await res(listRoute.POST(req('POST', payload)))).status).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect((await res(listRoute.POST(req('POST', payload)))).status).toBe(403);
    session.user = asMember(w.owner, w.friend, 'admin');
    const created = await res(listRoute.POST(req('POST', payload)));
    expect(created.status).toBe(201);
    const { id, settings } = (await created.json()) as { id: string; settings: { reenroll: boolean } };
    // Por la API un workflow nuevo arranca sin reinscripción.
    expect(settings.reenroll).toBe(false);

    session.user = asMember(w.owner, w.member);
    expect((await res(itemRoute.PATCH(req('PATCH', { name: 'Hacked' }), params(id)))).status).toBe(403);
    expect((await res(toggleRoute.POST(req('POST', { enabled: false }), params(id)))).status).toBe(403);
    expect((await res(itemRoute.DELETE(req('DELETE'), params(id)))).status).toBe(403);
    const seen = await (await res(itemRoute.GET(req('GET'), params(id)))).text();
    expect(seen).not.toContain('s3cr3t');
    expect(seen).not.toContain('key=abc');
    const listed = await (await res(listRoute.GET())).text();
    expect(listed).not.toContain('s3cr3t');

    session.user = asOwner(w.stranger);
    expect((await res(itemRoute.GET(req('GET'), params(id)))).status).toBe(404);

    session.user = asOwner(w.owner);
    expect((await res(toggleRoute.POST(req('POST', { enabled: false }), params(id)))).status).toBe(200);
    expect((await (await res(itemRoute.GET(req('GET'), params(id)))).text())).toContain('s3cr3t');
  });
});
