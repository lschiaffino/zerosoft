/**
 * Lo que sale fuera de un pedido (emails entrantes a Notes, eventos de
 * Voice) también sigue Apps del workspace: con la app
 * apagada para los miembros, al miembro no le llega ni se usa su dirección;
 * owner y admins siguen. Quien se fue del workspace, tampoco. Datos
 * inventados.
 */
import { describe, expect, it } from 'vitest';
import { saveWorkspaceAppRule } from '@/lib/workspace-apps';
import { personUsesVoice } from '@/lib/voice-events';
import { processNotesInbound } from '@/lib/notes-email';
import { addMember, removeMember } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const off = { mode: 'admins' as const, people: [], teams: [], denied: [] };

async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const admin = await makeUser(`${label}-admin`);
  await addMember(w.team.id, admin.id, 'admin');
  return { w, ws: w.owner.id, admin };
}

describe('Apps del workspace también fuera de un pedido', () => {
  it('Voice: el miembro deja de contar con la app apagada; owner y admin siguen; quien se fue, no', async () => {
    const s = await setup('arules-voice');
    expect(await personUsesVoice(s.ws, s.w.member.id)).toBe(true);
    await saveWorkspaceAppRule(s.ws, 'voice', off, s.ws);
    expect(await personUsesVoice(s.ws, s.w.member.id)).toBe(false);
    expect(await personUsesVoice(s.ws, s.admin.id)).toBe(true);
    expect(await personUsesVoice(s.ws, s.ws)).toBe(true);
    await removeMember(s.w.team.id, s.w.friend.id);
    expect(await personUsesVoice(s.ws, s.w.friend.id)).toBe(false);
    expect(await personUsesVoice(s.ws, s.w.stranger.id)).toBe(false);
  });

  it('Notes por email: con Notes apagada para el miembro, su dirección no crea notas', async () => {
    const s = await setup('arules-notes');
    const token = `tok-${crypto.randomUUID()}`;
    await getDb().prepare('INSERT INTO note_prefs (workspace_id, person_id, email_token) VALUES (?, ?, ?)').run(s.ws, s.w.member.id, token);
    await saveWorkspaceAppRule(s.ws, 'notes', off, s.ws);
    const res = await processNotesInbound(token, { emailId: 'e1', from: 'someone@client.test', subject: 'Hi', text: 'body', headers: {}, attachments: [], authentication: null });
    expect(res).toMatchObject({ status: 'skipped', reason: 'no_access' });
  });
});
