/**
 * CRM, bloque W2 (workflows como HubSpot): esperar hasta una fecha (una
 * propiedad del registro o del calendario), hasta un día y hora, o hasta que
 * pase un evento con un tope (Sí si pasó, No si se venció). Y la visibilidad
 * del historial con el flag guardado al inscribirse.
 *
 * Privacidad: el registro por acción no lleva fechas ni valores; una espera
 * sobre un campo oculto esconde el workflow; una espera sobre otro registro
 * esconde la inscripción a quien no ve todo; un cambio solo de campos ocultos
 * no despierta una espera "cualquier propiedad". Loops: la cadena se guarda
 * en la espera y la del evento que despierta se suma; un workflow no se
 * despierta con un evento de su propia cadena.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, createDeal, createPipeline, createStage, updateContact } from '@/lib/crm';
import {
  createWorkflow,
  listRecordEnrollments,
  listWorkflowRunViews,
  listWorkflowRuns,
  resumeWaitingWorkflowRuns,
  runWorkflowsForEvent,
  unenrollRun,
  updateWorkflow,
  workflowsForViewer,
} from '@/lib/crm-workflows';
import {
  actionLog,
  calendarDay,
  conditionsReachOtherEntity,
  dbTime,
  delayMissing,
  nextWeekdayAt,
  planWait,
  waitEventMatches,
  zonedInstant,
} from '@/lib/crm-workflow-rules';
import { actionMissing } from '@/lib/crm-workflow-catalog';
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

const itemRoute = await import('@/lib/routes/crm/workflows/[id]/route');

beforeEach(() => {
  session.user = null;
});

async function runs(ws: string, wf: string) {
  return listWorkflowRuns(ws, wf, 500);
}
async function subjects(ws: string) {
  const rows = (await getDb().prepare("SELECT subject FROM crm_activities WHERE user_id = ? AND type = 'task' ORDER BY subject").all(ws)) as Array<{
    subject: string;
  }>;
  return rows.map((r) => r.subject);
}
async function expireAll(ws: string) {
  await getDb().prepare("UPDATE crm_workflow_runs SET resume_at = '2000-01-01 00:00:00' WHERE user_id = ? AND status = 'waiting'").run(ws);
}
const waitForm = { type: 'delay' as const, config: { mode: 'event', event: 'form_submitted', timeoutAmount: 3, timeoutUnit: 'days' } };
const task = (subject: string, when?: 'yes' | 'no') => ({ type: 'create_task' as const, config: { subject, ...(when ? { when } : {}) } });
const formEvent = (contactId: string) => ({ type: 'form_submitted' as const, entity: 'contact' as const, entityId: contactId, payload: { formId: 'f' } });

describe('W2: reglas puras', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  it('una fecha a una hora en una zona horaria', () => {
    // 9:00 en Buenos Aires (UTC-3) son las 12:00 UTC.
    expect(zonedInstant(2026, 12, 1, '09:00', 'America/Argentina/Buenos_Aires').toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(zonedInstant(2026, 12, 1, '09:00', 'UTC').toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(calendarDay('2026-02-30')).toBeNull();
    expect(calendarDay('2026-03-04 10:00:00')).toEqual({ y: 2026, m: 3, d: 4 });
  });

  it('hasta una propiedad de fecha del registro, con días antes y hora', () => {
    const cfg = { mode: 'date', field: 'custom.renewal', offsetDays: 3, offsetDir: 'before', time: '10:30', tz: 'UTC' };
    const plan = planWait(cfg, now, { custom: JSON.stringify({ renewal: '2026-12-10' }) });
    expect(plan).toEqual({ kind: 'until', mode: 'date', at: new Date('2026-12-07T10:30:00Z') });
    // Sin valor o con la fecha pasada: sigue sin esperar.
    expect(planWait(cfg, now, { custom: '{}' })).toEqual({ kind: 'pass', reason: 'missing' });
    expect(planWait(cfg, now, { custom: JSON.stringify({ renewal: '2026-01-01' }) })).toEqual({ kind: 'pass', reason: 'past' });
    // Más de 2 años: falla con un código.
    expect(planWait(cfg, now, { custom: JSON.stringify({ renewal: '2031-01-01' }) })).toEqual({ kind: 'invalid', error: 'date_too_far' });
    // Fecha del calendario.
    expect(planWait({ mode: 'date', dateSource: 'calendar', date: '2026-12-24', time: '08:00', tz: 'UTC' }, now)).toMatchObject({
      kind: 'until',
      at: new Date('2026-12-24T08:00:00Z'),
    });
    expect(planWait({ mode: 'date', dateSource: 'calendar', date: 'nope' }, now)).toEqual({ kind: 'invalid', error: 'invalid_delay' });
  });

  it('hasta un día de la semana y hora, estrictamente después de ahora', () => {
    // 2026-11-22 es domingo.
    expect(nextWeekdayAt(now, [1], '09:00', 'UTC')?.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect(nextWeekdayAt(now, [7], '09:00', 'UTC')?.toISOString()).toBe('2026-11-29T09:00:00.000Z');
    expect(nextWeekdayAt(now, [7], '13:00', 'UTC')?.toISOString()).toBe('2026-11-22T13:00:00.000Z');
    expect(planWait({ mode: 'weekday', days: [], time: '09:00' }, now)).toEqual({ kind: 'invalid', error: 'invalid_delay' });
  });

  it('hasta un evento, con tope; lo que falta en el editor', () => {
    expect(planWait(waitForm.config, now)).toEqual({ kind: 'event', at: new Date('2026-11-25T12:00:00Z'), event: 'form_submitted', field: '' });
    expect(planWait({ mode: 'event', event: 'toString' }, now)).toEqual({ kind: 'invalid', error: 'invalid_delay' });
    expect(delayMissing({ mode: 'event' })).toEqual(['event']);
    expect(delayMissing({ mode: 'weekday', days: [] })).toEqual(['days']);
    expect(delayMissing({ mode: 'date', dateSource: 'calendar' })).toEqual(['date']);
    expect(actionMissing('delay', { mode: 'date', field: '' })).toEqual(['field']);
    expect(actionMissing('delay', { amount: 2, unit: 'days' })).toEqual([]);
  });

  it('qué evento despierta: propiedad elegida, o cualquiera menos los campos ocultos', () => {
    const upd = (changed: string[]) => ({ type: 'contact_updated', payload: { changed } });
    expect(waitEventMatches({ event: 'contact_updated', field: 'city' }, upd(['city']))).toBe(true);
    expect(waitEventMatches({ event: 'contact_updated', field: 'city' }, upd(['job_title']))).toBe(false);
    expect(waitEventMatches({ event: 'contact_updated' }, upd(['custom.salary']), new Set(['salary']))).toBe(false);
    expect(waitEventMatches({ event: 'contact_updated' }, upd(['custom.salary', 'city']), new Set(['salary']))).toBe(true);
    expect(waitEventMatches({ event: 'form_submitted' }, { type: 'meeting_booked' })).toBe(false);
  });

  it('una espera por un evento de otro registro cuenta como mirar otro registro', () => {
    const wf = (event: string) => ({ settings: { filters: [] }, actions: [{ type: 'delay', config: { mode: 'event', event } }] });
    expect(conditionsReachOtherEntity(wf('form_submitted'), 'contact')).toBe(false);
    expect(conditionsReachOtherEntity(wf('form_submitted'), 'deal')).toBe(true);
    expect(conditionsReachOtherEntity(wf('deal_won'), 'deal')).toBe(false);
  });

  it('el registro por acción dice qué esperó y cómo terminó, nunca la fecha', () => {
    const log = actionLog([
      { ok: true, type: 'delay', result: { wait: 'date', at: '2030-05-05' } },
      { ok: true, type: 'delay', result: { wait: 'date', passed: true } },
      { ok: true, type: 'delay', result: { wait: 'event', met: false } },
    ]);
    expect(log.map((l) => [l.wait, l.passed ?? null, l.met ?? null])).toEqual([
      ['date', null, null],
      ['date', true, null],
      ['event', null, false],
    ]);
    expect(JSON.stringify(log)).not.toContain('2030');
  });
});

describe('W2: esperas en el motor', () => {
  it('hasta una fecha de una propiedad del contacto: espera hasta ese día y después corre', async () => {
    const a = await makeUser('w2-date');
    await createCustomField(a.id, { entity: 'contacts', name: 'renewal', label: 'Renewal', type: 'date' });
    const wf = await createWorkflow(a.id, {
      name: 'Renewal',
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'delay', config: { mode: 'date', field: 'custom.renewal', offsetDays: 1, offsetDir: 'before', time: '09:00', tz: 'UTC' } },
        task('Renewal call'),
      ],
    });
    const future = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    await createContact(a.id, { email: 'r@w2.test', custom: { renewal: future } });
    const [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('waiting');
    const d = calendarDay(future)!;
    expect(run.resume_at).toBe(dbTime(zonedInstant(d.y, d.m, d.d - 1, '09:00', 'UTC')));
    expect(await subjects(a.id)).toEqual([]);
    await expireAll(a.id);
    await resumeWaitingWorkflowRuns();
    expect(await subjects(a.id)).toEqual(['Renewal call']);
    // Sin la propiedad: sigue enseguida.
    await createContact(a.id, { email: 'r2@w2.test' });
    expect(await subjects(a.id)).toEqual(['Renewal call', 'Renewal call']);
    const [last] = await runs(a.id, wf.id);
    const [admin] = (await listWorkflowRunViews(a.id, wf.id, undefined, 20, { log: true })).filter((v) => v.id === last.id);
    expect(admin.log?.[0]).toMatchObject({ type: 'delay', outcome: 'waited', wait: 'date', passed: true });
    expect(JSON.stringify(admin.log)).not.toContain(future);
  });

  it('hasta un día de la semana y hora', async () => {
    const a = await makeUser('w2-weekday');
    const wf = await createWorkflow(a.id, {
      name: 'Monday',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'delay', config: { mode: 'weekday', days: [1], time: '09:00', tz: 'America/Argentina/Buenos_Aires' } }, task('Monday')],
    });
    await createContact(a.id, { email: 'm@w2.test' });
    const [run] = await runs(a.id, wf.id);
    expect(run.status).toBe('waiting');
    const at = new Date(`${run.resume_at!.replace(' ', 'T')}Z`);
    expect(at.getUTCDay()).toBe(1);
    expect(at.getUTCHours()).toBe(12);
  });

  it('hasta un evento: Sí si pasa (lo despierta), No si se vence el tope', async () => {
    const a = await makeUser('w2-event');
    const wf = await createWorkflow(a.id, {
      name: 'Form follow-up',
      triggers: [{ type: 'contact_created' }],
      actions: [waitForm, task('Submitted', 'yes'), task('No answer', 'no')],
    });
    const c1 = await createContact(a.id, { email: 'yes@w2.test' });
    const c2 = await createContact(a.id, { email: 'no@w2.test' });
    expect((await runs(a.id, wf.id)).every((r) => r.status === 'waiting')).toBe(true);
    // Otro registro u otro evento no despierta.
    await runWorkflowsForEvent(a.id, { type: 'meeting_booked', entity: 'contact', entityId: c1.id });
    await runWorkflowsForEvent(a.id, formEvent(c1.id));
    // El cron de cada minuto lo corre: solo el que recibió el formulario.
    await resumeWaitingWorkflowRuns();
    expect(await subjects(a.id)).toEqual(['Submitted']);
    // Un segundo evento no lo vuelve a correr.
    await runWorkflowsForEvent(a.id, formEvent(c1.id));
    await resumeWaitingWorkflowRuns();
    expect(await subjects(a.id)).toEqual(['Submitted']);
    // El otro se vence: rama No.
    await expireAll(a.id);
    await resumeWaitingWorkflowRuns();
    expect(await subjects(a.id)).toEqual(['No answer', 'Submitted']);
    const views = await listWorkflowRunViews(a.id, wf.id, undefined, 20, { log: true });
    const byRecord = new Map(views.map((v) => [v.record?.id, v.log?.[0]]));
    expect(byRecord.get(c1.id)).toMatchObject({ wait: 'event', met: true });
    expect(byRecord.get(c2.id)).toMatchObject({ wait: 'event', met: false });
  });

  it('una espera sacada a mano o de otro workspace no se despierta', async () => {
    const a = await makeUser('w2-unenroll');
    const b = await makeUser('w2-unenroll-other');
    const wf = await createWorkflow(a.id, { name: 'U', triggers: [{ type: 'contact_created' }], actions: [waitForm, task('Submitted', 'yes')] });
    const c = await createContact(a.id, { email: 'u@w2.test' });
    const c2 = await createContact(a.id, { email: 'u2@w2.test' });
    const runsNow = await runs(a.id, wf.id);
    const first = runsNow.find((r) => r.trigger_entity_id === c.id)!;
    // Otro workspace con el mismo id de registro: nada.
    await runWorkflowsForEvent(b.id, formEvent(c2.id));
    expect(await unenrollRun(a.id, wf.id, first.id, a.id)).toBe(true);
    await runWorkflowsForEvent(a.id, formEvent(c.id));
    await resumeWaitingWorkflowRuns();
    expect(await subjects(a.id)).toEqual([]);
    const after = await runs(a.id, wf.id);
    expect(after.find((r) => r.id === first.id)?.status).toBe('unenrolled');
    expect(after.find((r) => r.trigger_entity_id === c2.id)?.status).toBe('waiting');
  });

  it('una espera "cualquier propiedad" no se despierta por un cambio solo de campos ocultos', async () => {
    const w = await workspaceWithMember('w2-anyprop');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'text' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: 'role:member', access: 'hidden' }]);
    const wf = await createWorkflow(w.owner.id, {
      name: 'Any change',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'delay', config: { mode: 'event', event: 'contact_updated', timeoutAmount: 1, timeoutUnit: 'days' } }, task('Changed', 'yes')],
    });
    const c = await createContact(w.owner.id, { email: 'any@w2.test' });
    await updateContact(w.owner.id, c.id, { custom: { salary: '1' } });
    await resumeWaitingWorkflowRuns();
    expect(await subjects(w.owner.id)).toEqual([]);
    expect((await runs(w.owner.id, wf.id))[0].status).toBe('waiting');
    await updateContact(w.owner.id, c.id, { city: 'Rosario' });
    await resumeWaitingWorkflowRuns();
    expect(await subjects(w.owner.id)).toEqual(['Changed']);
  });
});

describe('W2: guardas contra loops en las esperas', () => {
  it('la cadena del evento que despierta se suma: el workflow que lo causó no vuelve a correr', async () => {
    const a = await makeUser('w2-chain');
    // B: cuando cambia el puesto, cambia la ciudad (dispara la espera de A).
    const b = await createWorkflow(a.id, {
      name: 'B',
      settings: { reenroll: true },
      triggers: [{ type: 'contact_updated', config: { field: 'job_title' } }],
      actions: [{ type: 'update_field', config: { entity: 'contact', field: 'city', value: 'Rosario' } }],
    });
    // A: espera que cambie la ciudad y entonces cambia el puesto (que dispararía B otra vez).
    const wfA = await createWorkflow(a.id, {
      name: 'A',
      triggers: [{ type: 'contact_created' }],
      actions: [
        { type: 'delay', config: { mode: 'event', event: 'contact_updated', eventField: 'city', timeoutAmount: 1, timeoutUnit: 'days' } },
        { type: 'update_field', config: { entity: 'contact', field: 'job_title', value: 'Again', when: 'yes' } },
      ],
    });
    const c = await createContact(a.id, { email: 'chain@w2.test' });
    await updateContact(a.id, c.id, { jobTitle: 'First' });
    expect(await runs(a.id, b.id)).toHaveLength(1);
    const [waiting] = await runs(a.id, wfA.id);
    const state = JSON.parse(waiting.state ?? '{}') as { chain: { seen: string[] }; waitMet?: boolean };
    expect(state.waitMet).toBe(true);
    expect(state.chain.seen).toEqual(expect.arrayContaining([wfA.id, b.id]));
    await resumeWaitingWorkflowRuns();
    // A corrió por la rama Sí, pero B no vuelve a entrar desde la cadena guardada.
    expect((await runs(a.id, wfA.id))[0].status).toBe('done');
    expect(await runs(a.id, b.id)).toHaveLength(1);
  });

  it('un evento de la propia cadena del workflow no despierta sus esperas (sigue por el tope)', async () => {
    const a = await makeUser('w2-self');
    const p = await createPipeline(a.id, 'P');
    const s1 = (await createStage(a.id, p.id, { name: 'New' })) as { id: string };
    // Una inscripción de deal espera que cambie la ciudad de su contacto; la de contacto del mismo workflow la cambia.
    const wf = await createWorkflow(a.id, {
      name: 'Self',
      settings: { reenroll: true },
      triggers: [{ type: 'deal_created' }, { type: 'contact_updated', config: { field: 'job_title' } }],
      actions: [
        { type: 'delay', config: { mode: 'event', event: 'contact_updated', eventField: 'city', timeoutAmount: 1, timeoutUnit: 'days' } },
        { type: 'update_field', config: { entity: 'contact', field: 'city', value: 'Rosario' } },
      ],
    });
    const c = await createContact(a.id, { email: 'self@w2.test' });
    const deal = await createDeal(a.id, { name: 'D', pipelineId: p.id, stageId: s1.id, contactIds: [c.id] });
    if (!deal.ok) throw new Error('deal');
    const dealRun = (await runs(a.id, wf.id)).find((r) => r.trigger_entity === 'deal')!;
    expect(dealRun.status).toBe('waiting');
    expect(dealRun.wait_key).toBe(`contact_updated:contact:${c.id}`);
    // La inscripción de contacto espera; vencida, cambia la ciudad dentro de la cadena del workflow.
    await updateContact(a.id, c.id, { jobTitle: 'x' });
    await getDb().prepare("UPDATE crm_workflow_runs SET resume_at = '2000-01-01 00:00:00' WHERE workflow_id = ? AND trigger_entity = 'contact'").run(wf.id);
    await resumeWaitingWorkflowRuns();
    const again = (await runs(a.id, wf.id)).find((r) => r.id === dealRun.id)!;
    expect(again.status).toBe('waiting');
    expect(JSON.parse(again.state ?? '{}').waitMet).toBeUndefined();
  });
});

describe('W2: privacidad', () => {
  it('el historial usa los criterios del momento de la inscripción (flag guardado)', async () => {
    const w = await workspaceWithMember('w2-flag');
    await setMemberVisibility(w.owner.id, 'mine');
    const outsider = await makeUser('w2-flag-outsider');
    const { addMember } = await import('@/lib/teams');
    await addMember(w.team.id, outsider.id, 'member');
    const secret = await createCompany(w.owner.id, { name: 'Hidden Co', domain: 'whale.test', ownerId: outsider.id });
    const wf = await createWorkflow(w.owner.id, {
      name: 'Whale',
      settings: { filters: [{ entity: 'company', field: 'domain', op: 'equals', value: 'whale.test' }] },
      triggers: [{ type: 'contact_created' }],
      actions: [task('t')],
    });
    const old = await createContact(w.owner.id, { email: 'old@w2.test', ownerId: w.member.id, companyId: secret.id });
    // El admin cambia los criterios a un campo del contacto.
    await updateWorkflow(w.owner.id, wf.id, { settings: { filters: [{ entity: 'contact', field: 'city', op: 'equals', value: 'Rosario' }] } });
    const fresh = await createContact(w.owner.id, { email: 'new@w2.test', ownerId: w.member.id, city: 'Rosario' });
    const member = asMember(w.owner, w.member);
    const scope = await sessionScope(member);
    expect((await listWorkflowRunViews(w.owner.id, wf.id, scope)).map((v) => v.record?.id)).toEqual([fresh.id]);
    expect(await listRecordEnrollments(w.owner.id, 'contact', old.id, 20, sessionFieldViewer(member))).toEqual([]);
    expect(await listRecordEnrollments(w.owner.id, 'contact', fresh.id, 20, sessionFieldViewer(member))).toHaveLength(1);
    // Owner y admin ven las dos.
    expect(await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(asOwner(w.owner)))).toHaveLength(2);
    expect(await listRecordEnrollments(w.owner.id, 'contact', old.id, 20, sessionFieldViewer(asMember(w.owner, w.friend, 'admin')))).toHaveLength(1);
    // Una inscripción de antes de W2 (sin flag) no se le muestra a quien no ve todo.
    await getDb().prepare('UPDATE crm_workflow_runs SET reaches_other = NULL WHERE workflow_id = ?').run(wf.id);
    expect(await listWorkflowRunViews(w.owner.id, wf.id, scope)).toEqual([]);
    expect(await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(asOwner(w.owner)))).toHaveLength(2);
    // Sin alcance ("all"), el miembro sigue viendo todo como antes.
    await setMemberVisibility(w.owner.id, 'all');
    expect(await listWorkflowRunViews(w.owner.id, wf.id, await sessionScope(member))).toHaveLength(2);
  });

  it('esperar un evento de otro registro: un miembro con "mine" o de un equipo no ve la inscripción', async () => {
    const w = await workspaceWithMember('w2-cross');
    await setMemberVisibility(w.owner.id, 'team');
    await createSalesTeam(w.owner.id, { name: 'Ventas', members: [w.member.id, w.friend.id] });
    const p = await createPipeline(w.owner.id, 'P');
    const s1 = (await createStage(w.owner.id, p.id, { name: 'New' })) as { id: string };
    const wf = await createWorkflow(w.owner.id, {
      name: 'Deal waits for contact form',
      triggers: [{ type: 'deal_created' }],
      actions: [waitForm, task('Submitted', 'yes')],
    });
    const own = await createWorkflow(w.owner.id, {
      name: 'Deal waits for win',
      triggers: [{ type: 'deal_created' }],
      actions: [{ type: 'delay', config: { mode: 'event', event: 'deal_won', timeoutAmount: 1, timeoutUnit: 'days' } }, task('Won', 'yes')],
    });
    const c = await createContact(w.owner.id, { email: 'cross@w2.test', ownerId: w.friend.id });
    const deal = await createDeal(w.owner.id, { name: 'D', pipelineId: p.id, stageId: s1.id, contactIds: [c.id], ownerId: w.friend.id });
    if (!deal.ok) throw new Error('deal');
    // El evento en el contacto relacionado despierta la espera del deal.
    await runWorkflowsForEvent(w.owner.id, formEvent(c.id));
    await resumeWaitingWorkflowRuns();
    expect(await subjects(w.owner.id)).toEqual(['Submitted']);
    for (const viewer of [asMember(w.owner, w.member)]) {
      const scope = await sessionScope(viewer);
      expect(await listWorkflowRunViews(w.owner.id, wf.id, scope)).toEqual([]);
      expect((await listWorkflowRunViews(w.owner.id, own.id, scope)).map((v) => v.record?.id)).toEqual([deal.deal.id]);
      const card = await listRecordEnrollments(w.owner.id, 'deal', deal.deal.id, 20, sessionFieldViewer(viewer));
      expect(card.map((e) => e.workflow_name)).toEqual(['Deal waits for win']);
      expect(JSON.stringify(card)).not.toContain('reaches_other');
    }
    await setMemberVisibility(w.owner.id, 'mine');
    const mine = await sessionScope(asMember(w.owner, w.member));
    expect(await listWorkflowRunViews(w.owner.id, own.id, mine)).toEqual([]);
    const ownerCard = await listRecordEnrollments(w.owner.id, 'deal', deal.deal.id, 20, sessionFieldViewer(asOwner(w.owner)));
    expect(ownerCard.map((e) => e.workflow_name).sort()).toEqual(['Deal waits for contact form', 'Deal waits for win']);
  });

  it('esperar hasta un campo oculto: el miembro no ve el workflow ni la inscripción (ni la fecha)', async () => {
    const w = await workspaceWithMember('w2-hidden');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'contract_end', label: 'Contract end', type: 'date' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: 'role:member', access: 'hidden' }]);
    const wf = await createWorkflow(w.owner.id, {
      name: 'Contract end',
      triggers: [{ type: 'contact_created' }],
      actions: [{ type: 'delay', config: { mode: 'date', field: 'custom.contract_end', time: '09:00', tz: 'UTC' } }, task('Renew')],
    });
    const c = await createContact(w.owner.id, { email: 'hid@w2.test', custom: { contract_end: '2027-06-01' } });
    expect((await runs(w.owner.id, wf.id))[0].status).toBe('waiting');
    const member = asMember(w.owner, w.member);
    expect(await workflowsForViewer(sessionFieldViewer(member), [wf])).toEqual([]);
    expect(await listRecordEnrollments(w.owner.id, 'contact', c.id, 20, sessionFieldViewer(member))).toEqual([]);
    const adminCard = await listRecordEnrollments(w.owner.id, 'contact', c.id, 20, sessionFieldViewer(asMember(w.owner, w.friend, 'admin')));
    expect(adminCard).toHaveLength(1);
  });

  it('solo owner y admins editan esperas; un miembro, uno de un equipo de ventas y otro workspace no', async () => {
    const w = await workspaceWithMember('w2-perm');
    await createSalesTeam(w.owner.id, { name: 'Ventas', members: [w.friend.id] });
    const wf = await createWorkflow(w.owner.id, { name: 'P', triggers: [{ type: 'contact_created' }], actions: [task('t')] });
    const p = { params: Promise.resolve({ id: wf.id }) };
    const body = { actions: [waitForm, task('t', 'yes')] };
    const patch = async () => {
      const r = await itemRoute.PATCH(
        new NextRequest('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        p,
      );
      if (!r) throw new Error('no response');
      return r.status;
    };
    session.user = null;
    expect(await patch()).toBe(401);
    session.user = asMember(w.owner, w.member);
    expect(await patch()).toBe(403);
    session.user = asMember(w.owner, w.friend);
    expect(await patch()).toBe(403);
    session.user = asOwner(w.stranger);
    expect(await patch()).toBe(404);
    session.user = asMember(w.owner, w.friend, 'admin');
    expect(await patch()).toBe(200);
    session.user = asOwner(w.owner);
    expect(await patch()).toBe(200);
  });
});
