import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { acceptInvite, addMember, approveJoinRequest, createInvite, getInviteByToken, requestToJoin, setMemberApps, setMemberRole } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { personJoined } from '@/lib/workspace-lifecycle';
import { makeUser } from './helpers';

const uid = () => crypto.randomUUID().slice(0, 8);

/** Un contacto importado que espera a `email` (owner del otro CRM), con el owner por defecto. */
async function pendingContact(workspaceId: string, email: string): Promise<string> {
  const id = crypto.randomUUID();
  const db = getDb();
  await db
    .prepare("INSERT INTO crm_contacts (id, user_id, first_name, last_name, owner_id, created_at, updated_at) VALUES (?, ?, 'Imp', 'Ort', ?, datetime('now'), datetime('now'))")
    .run(id, workspaceId, workspaceId);
  await db
    .prepare(
      "INSERT INTO crm_import_pending_owners (workspace_id, email, provider, external_owner_id, entity, record_id, default_owner_id) VALUES (?, ?, 'hubspot', 'h1', 'contact', ?, ?)",
    )
    .run(workspaceId, email, id, workspaceId);
  return id;
}

const ownerOf = async (id: string) => ((await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(id)) as { owner_id: string }).owner_id;

describe('persona que se suma: registros importados de HubSpot (JOIN_STEPS)', () => {
  it('al aceptar la invitación, los registros que la esperaban pasan a ser suyos', async () => {
    const owner = await makeUser('jo');
    const team = await ensureWorkspace(owner.id);
    const email = `sam-${uid()}@hub.test`;
    const contact = await pendingContact(owner.id, email);
    const sam = await upsertUser({ email, name: 'Sam' });
    const inv = await createInvite(team.id, email, owner.id, { role: 'member' });
    await acceptInvite((await getInviteByToken(inv.token))!, sam.id);
    expect(await ownerOf(contact)).toBe(sam.id);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_import_pending_owners WHERE workspace_id = ?').get(owner.id)) as { n: number }).n).toBe(0);
  });

  it('también al aprobar un pedido por dominio; un guest no se los lleva', async () => {
    const owner = await makeUser('jd');
    const team = await ensureWorkspace(owner.id);
    const email = `ana-${uid()}@hub.test`;
    const contact = await pendingContact(owner.id, email);
    const ana = await upsertUser({ email, name: 'Ana' });
    // Guest: no reclama.
    expect((await personJoined({ ownerId: owner.id, teamId: team.id, userId: ana.id, role: 'guest' })).failed).toEqual([]);
    expect(await ownerOf(contact)).toBe(owner.id);
    const req = await requestToJoin(team, ana.id, ana.email, '*');
    expect(await approveJoinRequest(req.id, team.id, owner.id)).toBe(true);
    expect(await ownerOf(contact)).toBe(ana.id);
  });

  it('un guest que pasa a member (por invitación o por rol) reclama sus registros', async () => {
    const owner = await makeUser('jg');
    const team = await ensureWorkspace(owner.id);
    const email = `leo-${uid()}@hub.test`;
    const contact = await pendingContact(owner.id, email);
    const leo = await upsertUser({ email, name: 'Leo' });
    await addMember(team.id, leo.id, 'guest');
    expect(await ownerOf(contact)).toBe(owner.id);
    const inv = await createInvite(team.id, email, owner.id, { role: 'member' });
    await acceptInvite((await getInviteByToken(inv.token))!, leo.id);
    expect(await ownerOf(contact)).toBe(leo.id);

    const email2 = `mia-${uid()}@hub.test`;
    const contact2 = await pendingContact(owner.id, email2);
    const mia = await upsertUser({ email: email2, name: 'Mia' });
    await addMember(team.id, mia.id, 'guest');
    await setMemberRole(team.id, mia.id, 'member');
    expect(await ownerOf(contact2)).toBe(mia.id);
  });

  it('sin el CRM no reclama: queda pendiente y se reclama cuando le habilitan el CRM', async () => {
    const owner = await makeUser('jc');
    const team = await ensureWorkspace(owner.id);
    const email = `noa-${uid()}@hub.test`;
    const contact = await pendingContact(owner.id, email);
    const noa = await upsertUser({ email, name: 'Noa' });
    await addMember(team.id, noa.id, 'member', { apps: ['docs'] });
    expect(await ownerOf(contact)).toBe(owner.id);
    expect(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_import_pending_owners WHERE workspace_id = ?').get(owner.id)) as { n: number }).n).toBe(1);
    await setMemberApps(team.id, noa.id, ['docs', 'crm']);
    expect(await ownerOf(contact)).toBe(noa.id);
  });
});
