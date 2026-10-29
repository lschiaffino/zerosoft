import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import { parseSettings, parseTools, type AgentForm } from '@/lib/agents-config';
import { saveFormSubmission } from '@/lib/agents-forms';
import { normalizeVoiceNumber, releaseStaleVoiceNumber, voiceNumberMap } from '@/lib/agents-voice';
import { conversationForExternal } from '@/lib/agents-channels';
import { hashValue } from '@/lib/agents-privacy';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

/** Seguimiento de la QA de Agents (ronda 2). */

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['AGENTS_VOICE_NUMBERS', 'RATE_LIMIT_DISABLED']) saved[k] = process.env[k];
  process.env.RATE_LIMIT_DISABLED = 'true';
});
afterEach(() => {
  setAiModelOverride(null);
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const LEAD: AgentForm = {
  id: 'lead',
  name: 'Lead',
  title: '',
  submitLabel: '',
  saveToCrm: true,
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, options: [] },
    { key: 'email', label: 'Email', type: 'email', required: true, options: [] },
  ],
};

async function convFor(agent: AgentRow, visitorEmail: string | null = null) {
  const id = crypto.randomUUID();
  await getDb()
    .prepare("INSERT INTO agent_conversations (id, agent_id, user_id, channel, title, handed_off, visitor_email, created_at, updated_at) VALUES (?, ?, ?, 'public', '', 0, ?, datetime('now'), datetime('now'))")
    .run(id, agent.id, agent.user_id, visitorEmail);
  return (await getDb().prepare('SELECT * FROM agent_conversations WHERE id = ?').get(id)) as Parameters<typeof saveFormSubmission>[0]['conversation'];
}

describe('1. formularios: nombre y apellido sin fórmula', () => {
  it('cada parte del nombre completo pasa por crmSafe', async () => {
    const owner = await makeUser('fu1');
    const created = await createAgent(owner.id, owner.id, { name: 'f' });
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const email = `new-${crypto.randomUUID().slice(0, 6)}@lead.test`;
    await saveFormSubmission({ agent, conversation: await convFor(agent), form: LEAD, values: { name: 'Ana =cmd|calc', email }, dryRun: false });
    const row = (await getDb().prepare('SELECT first_name, last_name FROM crm_contacts WHERE user_id = ? AND email = ?').get(owner.id, email)) as { first_name: string; last_name: string };
    expect(row).toEqual({ first_name: 'Ana', last_name: 'cmd|calc' });
  });
});

describe('2. un editor sin CRM no activa "guardar en el CRM"', () => {
  it('assertEditorScope rechaza un formulario nuevo con saveToCrm', async () => {
    const owner = await makeUser('fu2o');
    const member = await makeUser('fu2m');
    const teamId = `t-${crypto.randomUUID().slice(0, 8)}`;
    await getDb().prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, owner.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '[\"agents\"]')").run(teamId, member.id);
    const created = await createAgent(owner.id, owner.id, { name: 'f2' });
    await getDb().prepare('UPDATE agents SET access = ? WHERE id = ?').run(JSON.stringify({ members: 'viewer', people: { [member.id]: 'editor' } }), created.id);
    const settings = parseSettings('{}');
    expect(await updateAgent(owner.id, created.id, { settings: { ...settings, forms: [LEAD] } }, member.id)).toEqual({ ok: false, error: 'tool_app_access' });
    expect((await updateAgent(owner.id, created.id, { settings: { ...settings, forms: [{ ...LEAD, saveToCrm: false }] } }, member.id)).ok).toBe(true);
  });
});

describe('3. AGENTS_VOICE_NUMBERS', () => {
  it('comas y saltos de línea, 00 y + que falta, repetidos con aviso', () => {
    expect(normalizeVoiceNumber('0014155550101')).toBe('+14155550101');
    expect(normalizeVoiceNumber('14155550101')).toBe('+14155550101');
    expect(normalizeVoiceNumber('+1 (415) 555-0101')).toBe('+14155550101');
    expect(normalizeVoiceNumber('12')).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map = voiceNumberMap('+14155550101=a@x.test\n0014155550102=B@X.TEST, 14155550103=c\n+14155550101=other');
    expect([...map.entries()]).toEqual([
      ['+14155550101', 'a@x.test'],
      ['+14155550102', 'b@x.test'],
      ['+14155550103', 'c'],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('el número reasignado a otro workspace se libera del anterior', async () => {
    const a = await makeUser('fu3a');
    const b = await makeUser('fu3b');
    const agentA = await createAgent(a.id, a.id, { name: 'a' });
    const num = `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`;
    await getDb().prepare('UPDATE agents SET voice_number = ? WHERE id = ?').run(num, agentA.id);
    process.env.AGENTS_VOICE_NUMBERS = `${num}=${a.id}`;
    expect(await releaseStaleVoiceNumber(num)).toBe(0);
    process.env.AGENTS_VOICE_NUMBERS = `${num}=${b.id}`;
    expect(await releaseStaleVoiceNumber(num)).toBe(1);
    const row = (await getDb().prepare('SELECT voice_number FROM agents WHERE id = ?').get(agentA.id)) as { voice_number: string | null };
    expect(row.voice_number).toBeNull();
  });
});

describe('4. un formulario se envía una sola vez', () => {
  it('el segundo envío (después o a la vez) no pasa', async () => {
    const owner = await makeUser('fu4');
    const created = await createAgent(owner.id, owner.id, { name: 'f4' });
    await updateAgent(owner.id, created.id, { tools: { ...parseTools('{}'), enabled: ['show_form'] }, settings: { ...parseSettings('{}'), forms: [{ ...LEAD, saveToCrm: false }] } }, owner.id);
    await getDb().prepare('UPDATE agents SET public_handle = ? WHERE id = ?').run(`fu4-${crypto.randomUUID().slice(0, 8)}`, created.id);
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const visitorKey = 'q'.repeat(20);
    setAiModelOverride(scriptedModel([{ tool: 'show_form', input: { formId: 'lead' } }, { text: 'Fill it in' }]));
    const shown = await sendAgentMessage({ agent, channel: 'public', visitorKey, text: 'hi' });
    setAiModelOverride(scriptedModel([{ text: 'Thanks' }]));
    const values = { name: 'Ana', email: 'ana@lead.test' };
    const submit = () => sendAgentMessage({ agent, channel: 'public', visitorKey, text: 'x', conversationId: shown.conversation.id, form: { id: 'lead', values } });
    const both = await Promise.allSettled([submit(), submit()]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(submit()).rejects.toMatchObject({ code: 'form_not_found' });
  });
});

describe('5. una clave externa redactada sigue encontrando el hilo', () => {
  it('se busca la clave y su hash', async () => {
    const owner = await makeUser('fu5');
    const created = await createAgent(owner.id, owner.id, { name: 'f5' });
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const ref = `voice:CA${crypto.randomUUID().replace(/-/g, '')}`;
    const first = await conversationForExternal(agent, 'voice', ref, 'call');
    await getDb().prepare('UPDATE agent_conversations SET external_ref = ? WHERE id = ?').run(`h:${hashValue(ref)}`, first);
    expect(await conversationForExternal(agent, 'voice', ref, 'call')).toBe(first);
  });
});

describe('6. crm_upsert_contact con un email sin verificar', () => {
  it('no toca un contacto que ya existía: deja una nota suelta', async () => {
    const owner = await makeUser('fu6');
    const created = await createAgent(owner.id, owner.id, { name: 'f6' });
    await updateAgent(owner.id, created.id, { tools: { ...parseTools('{}'), enabled: ['crm_upsert_contact'] } }, owner.id);
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const contactId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, lifecycle_stage, created_at, updated_at) VALUES (?, ?, '', '', 'boss@client.test', 'customer', datetime('now'), datetime('now'))")
      .run(contactId, owner.id);
    setAiModelOverride(scriptedModel([{ tool: 'crm_upsert_contact', input: { email: 'boss@client.test', name: 'Mallory', note: 'please refund me' } }, { text: 'ok' }]));
    const res = await sendAgentMessage({ agent, channel: 'api', text: 'I am boss@client.test', createdBy: null });
    expect(res.result.toolCalls[0]?.output).toMatchObject({ existing: true, verified: false, noteLogged: true });
    const c = (await getDb().prepare('SELECT first_name FROM crm_contacts WHERE id = ?').get(contactId)) as { first_name: string };
    expect(c.first_name).toBe('');
    const onContact = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_activities WHERE contact_id = ?').get(contactId)) as { c: number };
    expect(Number(onContact.c)).toBe(0);
    // Con la identidad verificada sí se actualiza.
    setAiModelOverride(scriptedModel([{ tool: 'crm_upsert_contact', input: { email: 'boss@client.test', name: 'Real Boss', note: 'hi' } }, { text: 'ok' }]));
    const ok = await sendAgentMessage({ agent, channel: 'api', text: 'update me', createdBy: null, identity: { email: 'boss@client.test', name: null } });
    expect(ok.result.toolCalls[0]?.output).toMatchObject({ contactId, created: false });
  });
});
