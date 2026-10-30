import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import { parseTools } from '@/lib/agents-config';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

/**
 * Hotfix: en el playground, crm_find_contact (y las otras lecturas de CRM, MCP
 * y HTTP) solo corren para quien edita el agente y tiene la app, y la
 * identidad "verificada" es su propio email.
 */
beforeEach(() => {
  process.env.RATE_LIMIT_DISABLED = 'true';
});
afterEach(() => setAiModelOverride(null));

async function workspaceWithMember(apps: string, role = 'member') {
  const owner = await makeUser('pgown');
  const member = await makeUser('pgmem');
  const teamId = `t-${crypto.randomUUID().slice(0, 8)}`;
  await getDb().prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, owner.id);
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, member.id, role, apps);
  const created = await createAgent(owner.id, owner.id, { name: 'pg agent' });
  const res = await updateAgent(owner.id, created.id, { tools: { ...parseTools('{}'), enabled: ['crm_find_contact'] } }, owner.id);
  if (!res.ok) throw new Error(res.error);
  await getDb()
    .prepare("INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, lifecycle_stage, created_at, updated_at) VALUES (?, ?, 'Secret', 'Person', 'secret@client.test', 'customer', datetime('now'), datetime('now'))")
    .run(crypto.randomUUID(), owner.id);
  return { owner, member, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

async function lookup(agent: AgentRow, personId: string, email: string) {
  setAiModelOverride(scriptedModel([{ tool: 'crm_find_contact', input: { email } }, { text: 'ok' }]));
  const res = await sendAgentMessage({ agent, channel: 'playground', text: `look up ${email}`, createdBy: personId });
  return res.result.toolCalls[0]?.output as Record<string, unknown>;
}

describe('playground: lecturas del CRM', () => {
  it('un miembro sin edición (o sin la app CRM) no lee contactos', async () => {
    const { member, agent } = await workspaceWithMember('["agents"]');
    expect((await lookup(agent, member.id, 'secret@client.test')).error).toMatch(/^playground_no_(access|app)$/);
    const other = await workspaceWithMember('["agents","crm"]');
    expect(await lookup(other.agent, other.member.id, 'secret@client.test')).toEqual({ error: 'playground_no_access' });
  });

  it('un admin con CRM solo verifica su propio email', async () => {
    const { owner, agent } = await workspaceWithMember('["agents"]');
    expect(await lookup(agent, owner.id, 'secret@client.test')).toEqual({ error: 'identity_not_verified' });
    expect(await lookup(agent, owner.id, owner.email)).toEqual({ found: false });
  });

  it('un admin sin la app CRM no lee contactos', async () => {
    const { member, agent } = await workspaceWithMember('["agents"]', 'admin');
    expect((await lookup(agent, member.id, 'secret@client.test')).error).toMatch(/^playground_no_(access|app)$/);
  });
});
