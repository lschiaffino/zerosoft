import { describe, expect, it } from 'vitest';
import {
  addListMembers,
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createList,
  createPipeline,
  createStage,
  fireDueTasks,
  getContact,
  getList,
  mergeContacts,
  updateActivity,
  updateContact,
  updateDeal,
} from '@/lib/crm';
import { CrmRefError } from '@/lib/crm-refs';
import { createWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { addMember, createTeam } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

async function pipelineFor(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const s = await createStage(userId, p.id, { name: 'New' });
  return { pipelineId: p.id, stageId: (s as { id: string }).id };
}

describe('CRM: referencias entre workspaces', () => {
  it('no deja vincular una empresa de otro workspace', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const foreign = await createCompany(b.id, { name: 'Ajena' });
    await expect(createContact(a.id, { email: 'x@a.test', companyId: foreign.id })).rejects.toBeInstanceOf(
      CrmRefError,
    );
    const mine = await createContact(a.id, { email: 'y@a.test' });
    await expect(updateContact(a.id, mine.id, { companyId: foreign.id })).rejects.toThrow('invalid_company');
  });

  it('el owner tiene que ser del workspace (dueño o miembro del team)', async () => {
    const owner = await makeUser('owner');
    const member = await makeUser('member');
    const stranger = await makeUser('stranger');
    const team = await createTeam(owner.id, 'Team');
    await addMember(team.id, member.id);

    const ok = await createContact(owner.id, { email: 'a@b.test', ownerId: member.id });
    expect(ok.owner_id).toBe(member.id);
    await expect(createContact(owner.id, { email: 'c@d.test', ownerId: stranger.id })).rejects.toThrow(
      'invalid_owner',
    );
  });

  it('getContact no devuelve la empresa de otro workspace aunque el id esté guardado', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const foreign = await createCompany(b.id, { name: 'Ajena' });
    const c = await createContact(a.id, { email: 'z@a.test' });
    await getDb().prepare('UPDATE crm_contacts SET company_id = ? WHERE id = ?').run(foreign.id, c.id);
    expect((await getContact(a.id, c.id))?.company).toBeNull();
  });

  it('deals y listas descartan contactos ajenos', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const mine = await createContact(a.id, { email: 'm@a.test' });
    const theirs = await createContact(b.id, { email: 't@b.test' });
    const { pipelineId, stageId } = await pipelineFor(a.id);

    const res = await createDeal(a.id, { name: 'D', pipelineId, stageId, contactIds: [mine.id, theirs.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const linked = (await getDb()
      .prepare('SELECT contact_id FROM crm_deal_contacts WHERE deal_id = ?')
      .all(res.deal.id)) as Array<{ contact_id: string }>;
    expect(linked.map((r) => r.contact_id)).toEqual([mine.id]);

    await updateDeal(a.id, res.deal.id, { addContactIds: [theirs.id] });
    const after = (await getDb()
      .prepare('SELECT COUNT(*) AS n FROM crm_deal_contacts WHERE deal_id = ?')
      .get(res.deal.id)) as { n: number };
    expect(after.n).toBe(1);

    const list = await createList(a.id, { name: 'L' });
    expect(await addListMembers(a.id, list.id, [mine.id, theirs.id])).toBe(1);
    // La lista de A no se puede llenar desde B.
    expect(await addListMembers(b.id, list.id, [theirs.id])).toBe(0);
    expect((await getList(a.id, list.id))?.members.map((m) => m.id)).toEqual([mine.id]);
  });

  it('las actividades no pueden apuntar a registros ajenos', async () => {
    const a = await makeUser('a');
    const b = await makeUser('b');
    const theirs = await createContact(b.id, { email: 'q@b.test' });
    await expect(createActivity(a.id, { type: 'note', contactId: theirs.id })).rejects.toThrow('invalid_contact');
  });
});

describe('CRM: listas dinámicas', () => {
  it('el conteo es el real aunque se muestren 500', async () => {
    const a = await makeUser('a');
    const db = getDb();
    for (let i = 0; i < 510; i++) {
      await db
        .prepare("INSERT INTO crm_contacts (id, user_id, email, lifecycle_stage) VALUES (?, ?, ?, 'customer')")
        .run(crypto.randomUUID(), a.id, `c${i}@a.test`);
    }
    const list = await createList(a.id, { name: 'Clientes', kind: 'dynamic', filter: { lifecycle: 'customer' } });
    const detail = await getList(a.id, list.id);
    expect(detail?.members).toHaveLength(500);
    expect(detail?.memberCount).toBe(510);
  });
});

describe('CRM: merge de contactos', () => {
  it('mueve deals, actividades y emails al contacto que queda', async () => {
    const a = await makeUser('a');
    const keep = await createContact(a.id, { email: 'dup@a.test', firstName: 'Keep' });
    const drop = await createContact(a.id, { email: 'dup@a.test', firstName: 'Drop' });
    await createActivity(a.id, { type: 'note', subject: 'nota', contactId: drop.id });
    await getDb()
      .prepare(
        `INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, direction, from_email, to_emails, subject, snippet, sent_at)
         VALUES (?, ?, ?, ?, '', 'in', 'dup@a.test', 'me@a.test', 'hola', '', datetime('now'))`,
      )
      .run(crypto.randomUUID(), a.id, drop.id, crypto.randomUUID());

    await mergeContacts(a.id, keep.id, drop.id);
    const db = getDb();
    const acts = (await db.prepare('SELECT COUNT(*) AS n FROM crm_activities WHERE contact_id = ?').get(keep.id)) as {
      n: number;
    };
    const emails = (await db.prepare('SELECT COUNT(*) AS n FROM crm_emails WHERE contact_id = ?').get(keep.id)) as {
      n: number;
    };
    expect(acts.n).toBe(1);
    expect(emails.n).toBe(1);
    expect(await getContact(a.id, drop.id)).toBeNull();
  });
});

describe('CRM: workflows', () => {
  it('un update_field sobre el mismo contacto no entra en loop', async () => {
    const a = await makeUser('a');
    const wf = await createWorkflow(a.id, {
      name: 'Loop',
      enabled: true,
      triggers: [{ type: 'contact_updated' }],
      actions: [{ type: 'update_field', config: { entity: 'contact', field: 'city', value: 'Rosario' } }],
    });
    const c = await createContact(a.id, { email: 'loop@a.test' });
    await updateContact(a.id, c.id, { firstName: 'Ana' });

    const runs = await listWorkflowRuns(a.id, wf.id);
    expect(runs).toHaveLength(1);
    expect((await getContact(a.id, c.id))?.contact.city).toBe('Rosario');
  });

  it('task_due se dispara cuando la tarea vence (cron), una sola vez', async () => {
    const a = await makeUser('a');
    const wf = await createWorkflow(a.id, {
      name: 'Vencidas',
      enabled: true,
      triggers: [{ type: 'task_due' }],
      actions: [{ type: 'notify_user', config: { message: 'venció' } }],
    });
    const future = await createActivity(a.id, { type: 'task', subject: 'futuro', dueAt: '2999-01-01 00:00:00' });
    const past = await createActivity(a.id, { type: 'task', subject: 'pasado', dueAt: '2000-01-01 00:00:00' });
    // Crear la tarea ya no dispara el trigger.
    expect(await listWorkflowRuns(a.id, wf.id)).toHaveLength(0);

    await fireDueTasks();
    await fireDueTasks();
    expect(await listWorkflowRuns(a.id, wf.id)).toHaveLength(1);

    // Si se reprograma a una fecha vencida, vuelve a avisar.
    await updateActivity(a.id, past.id, { dueAt: '2001-01-01 00:00:00' });
    await fireDueTasks();
    expect(await listWorkflowRuns(a.id, wf.id)).toHaveLength(2);
    expect(future.id).toBeTruthy();
  });

  it('send_email acepta el destinatario desde una propiedad custom', async () => {
    const a = await makeUser('a');
    const wf = await createWorkflow(a.id, {
      name: 'Facturación',
      enabled: true,
      triggers: [{ type: 'contact_created' }],
      actions: [
        {
          type: 'send_email',
          config: { to: '{{contact.custom.billing}}', subject: 'Hola {{contact.firstName}}', body: 'x' },
        },
      ],
    });
    await createContact(a.id, { email: 'p@a.test', firstName: 'Pía', custom: { billing: 'facturas@a.test' } });
    const [run] = await listWorkflowRuns(a.id, wf.id);
    const output = JSON.parse(run.output) as { results: Array<{ error?: string }> };
    // Sin RESEND_API_KEY el envío puede fallar, pero nunca por falta de destinatario.
    expect(output.results[0].error).not.toBe('missing_recipient');
  });
});

describe('Zona horaria del usuario', () => {
  it('"hoy" en Buenos Aires es 03:00Z → 02:59:59Z del día siguiente', async () => {
    const { dayRangeUtc } = await import('@/lib/user-tz');
    // 23:30 del 12/10 en Buenos Aires = 02:30Z del 13/10.
    const at = new Date('2026-10-13T02:30:00Z');
    expect(dayRangeUtc('America/Argentina/Buenos_Aires', at)).toEqual({
      start: '2026-10-12 03:00:00',
      end: '2026-10-13 02:59:59',
    });
    expect(dayRangeUtc('UTC', at)).toEqual({ start: '2026-10-13 00:00:00', end: '2026-10-13 23:59:59' });
    expect(dayRangeUtc('Asia/Tokyo', at).start).toBe('2026-10-12 15:00:00');
  });
});
