/**
 * CRM: una lista dinámica se evalúa con lo que ve quien la usa, también al
 * correr un agente sobre ella: un filtro que cuenta asociados (deals de un
 * contacto, deal abierto) cuenta solo los deals que la persona ve, así la
 * lista no delata un deal oculto. Miradas: otro workspace, miembro con
 * "mine", admin y owner. Datos inventados.
 */
import { describe, expect, it } from 'vitest';
import { createContact, createDeal, createList, createPipeline, createStage } from '@/lib/crm';
import { createRun } from '@/lib/crm-ai-agents';
import { listForViewer } from '@/lib/crm-list-access';
import { sessionScope, setMemberVisibility } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { addMember } from '@/lib/teams';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  // Dos contactos de la persona: uno con un deal que solo ve el owner y otro sin deals.
  const withHidden = await createContact(ws, { firstName: 'WithHiddenDeal', email: `a-${label}@client.test`, ownerId: w.member.id });
  const plain = await createContact(ws, { firstName: 'NoDeal', email: `b-${label}@client.test`, ownerId: w.member.id });
  const p = await createPipeline(ws, 'Sales');
  const stage = await createStage(ws, p.id, { name: 'Open' });
  await createDeal(ws, { name: 'Hidden deal', pipelineId: p.id, stageId: stage!.id, ownerId: ws, contactIds: [withHidden.id] });
  const byDeals = await createList(ws, { name: 'With deals', entity: 'contacts', kind: 'dynamic', filter: { filters: [{ f: 'dealCount', o: 'gt', v: '0' }] } });
  const openDeal = await createList(ws, { name: 'Open deal', entity: 'contacts', kind: 'dynamic', filter: { filters: [{ f: 'hasOpenDeal', o: 'is', v: 'true' }] } });
  return { w, ws, adminPerson, withHidden, plain, p, stage: stage!, lists: [byDeals.id, openDeal.id] };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function runTargets(s: Setup, user: ReturnType<typeof asOwner>, listId: string): Promise<string[] | 'no_targets'> {
  try {
    const run = await createRun({
      workspaceId: s.ws,
      personId: user.actingUser?.id ?? user.id,
      scope: await sessionScope(user),
      input: { agent: 'enrich_contacts', listId },
      defaultName: 'Run',
    });
    const { getDb } = await import('@/lib/db');
    const rows = (await getDb().prepare('SELECT entity_id FROM crm_ai_run_items WHERE run_id = ?').all(run.id)) as Array<{ entity_id: string }>;
    return rows.map((r) => r.entity_id).sort();
  } catch (err) {
    if ((err as { code?: string }).code === 'no_targets') return 'no_targets';
    throw err;
  }
}

describe('listas dinámicas con conteos de asociados: con lo que ve quien las usa', () => {
  it('miembro con "mine": ni la lista ni el agente sobre ella delatan el deal oculto', async () => {
    const s = await setup('lagent-member');
    const member = asMember(s.w.owner, s.w.member);
    for (const listId of s.lists) {
      const detail = await listForViewer(sessionFieldViewer(member), listId, await sessionScope(member));
      expect(detail?.members.map((m) => m.id)).toEqual([]);
      expect(detail?.memberCount).toBe(0);
      expect(await runTargets(s, member, listId)).toBe('no_targets');
    }
    // Con un deal propio, el contacto sí entra.
    await createDeal(s.ws, { name: 'Own deal', pipelineId: s.p.id, stageId: s.stage.id, ownerId: s.w.member.id, contactIds: [s.plain.id] });
    for (const listId of s.lists) expect(await runTargets(s, member, listId)).toEqual([s.plain.id]);
  });

  it('owner y admin ven todos los deals: el contacto con el deal entra', async () => {
    const s = await setup('lagent-admin');
    for (const user of [asOwner(s.w.owner), asMember(s.w.owner, s.adminPerson, 'admin')]) {
      for (const listId of s.lists) expect(await runTargets(s, user, listId)).toEqual([s.withHidden.id]);
    }
  });

  it('otro workspace: la lista no existe para él', async () => {
    const s = await setup('lagent-other');
    const stranger = asOwner(s.w.stranger);
    await expect(
      createRun({ workspaceId: s.w.stranger.id, personId: s.w.stranger.id, scope: await sessionScope(stranger), input: { agent: 'enrich_contacts', listId: s.lists[0] }, defaultName: 'Run' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
