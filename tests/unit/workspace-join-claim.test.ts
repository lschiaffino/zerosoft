import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { acceptInvite, approveJoinRequest, createInvite, getInviteByToken, requestToJoin } from '@/lib/teams';
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
});
