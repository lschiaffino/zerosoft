import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAiModelOverride } from '@/lib/ai';
import { getDb } from '@/lib/db';
import { createActivity, createContact } from '@/lib/crm';
import { buildRecordContext } from '@/lib/crm-ai';
import { coerceFieldValue, runAssistant } from '@/lib/crm-ai-assistant';
import { aiOptionHelpers } from '@/lib/crm-ai-options';
import { applyFieldFollowup, generateFollowups } from '@/lib/crm-ai-followup';
import type { FieldViewer } from '@/lib/crm-field-perms';
import { addOption, updateOption } from '@/lib/crm-property-options';
import { makeUser } from './helpers';
import { mockModel, scriptedModel } from './ai-mock';

/**
 * CRM C5: el asistente y las propuestas tras una llamada ofrecen las opciones
 * de Lifecycle stage y Lead status del workspace (propias y renombradas), no
 * las archivadas ni las de otro workspace. Datos inventados.
 */
const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH', 'CRM_AI_FAKE', 'RATE_LIMIT_DISABLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RATE_LIMIT_DISABLED = 'true';
});

afterEach(() => {
  setAiModelOverride(null);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const tag = () => crypto.randomUUID().slice(0, 6);

/** Workspace con una etapa propia, un estado propio, "subscriber" archivada y "customer" renombrada. */
async function workspace(prefix: string) {
  const u = await makeUser(prefix);
  const trial = await addOption(u.id, 'lifecycle', 'Trial user');
  const nurturing = await addOption(u.id, 'leadStatus', 'Nurturing');
  await updateOption(u.id, 'lifecycle', 'subscriber', { archived: true });
  await updateOption(u.id, 'lifecycle', 'customer', { label: 'Paying account' });
  const contact = await createContact(u.id, { firstName: 'Iris', lastName: `Vale${tag()}`, email: `iris-${tag()}@example.test` });
  return { u, trial, nurturing, contact };
}

function toolDescription(model: ReturnType<typeof scriptedModel>, name: string): string {
  const tools = (model.doGenerateCalls[0].tools ?? []) as Array<{ name: string; description?: string }>;
  return tools.find((t) => t.name === name)?.description ?? '';
}

describe('coerceFieldValue con las opciones del workspace', () => {
  it('acepta la clave o el nombre de una activa; rechaza archivadas y las de otro workspace', async () => {
    const a = await workspace('c5-opt-a');
    const b = await makeUser('c5-opt-b');
    await addOption(b.id, 'lifecycle', 'Secret tier');
    const opts = await aiOptionHelpers(a.u.id, 'en');
    const choices = (prop: 'lifecycle' | 'leadStatus') => opts.choices(prop);

    expect(coerceFieldValue('contact', 'lifecycleStage', 'trial USER', choices)).toBe(a.trial.value);
    expect(coerceFieldValue('contact', 'lifecycleStage', a.trial.value, choices)).toBe(a.trial.value);
    expect(coerceFieldValue('company', 'lifecycleStage', 'Paying account', choices)).toBe('customer');
    expect(coerceFieldValue('contact', 'lifecycleStage', 'customer', choices)).toBe('customer');
    expect(coerceFieldValue('contact', 'leadStatus', 'nurturing', choices)).toBe(a.nurturing.value);
    // Archivada: no se propone.
    expect(coerceFieldValue('contact', 'lifecycleStage', 'subscriber', choices)).toBeNull();
    expect(coerceFieldValue('contact', 'lifecycleStage', 'Subscriber', choices)).toBeNull();
    // La opción de otro workspace no existe acá.
    expect(coerceFieldValue('contact', 'lifecycleStage', 'Secret tier', choices)).toBeNull();
    // Deals no tienen lifecycle; claves heredadas de Object no son campos.
    expect(coerceFieldValue('deal', 'lifecycleStage', 'customer', choices)).toBeNull();
    expect(coerceFieldValue('contact', 'constructor', 'x', choices)).toBeNull();
    // Sin opciones del workspace, las de fábrica.
    expect(coerceFieldValue('contact', 'lifecycleStage', 'SUBSCRIBER')).toBe('subscriber');
  });
});

describe('asistente: opciones del workspace', () => {
  it('las ofrece al modelo y propone la clave con el nombre en la tarjeta', async () => {
    const a = await workspace('c5-asst');
    const b = await makeUser('c5-asst-other');
    await addOption(b.id, 'lifecycle', 'Secret tier');
    const model = scriptedModel((i) =>
      i === 0
        ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'lifecycleStage', value: 'Trial user' } }
        : i === 1
          ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'leadStatus', value: 'Nurturing' } }
          : { text: 'Review and confirm.' },
    );
    setAiModelOverride(model);
    const reply = await runAssistant({
      workspaceId: a.u.id,
      personId: a.u.id,
      scope: null,
      request: { messages: [{ role: 'user', content: 'Mark Iris as a trial user, nurturing' }], locale: 'en' },
    });

    const description = toolDescription(model, 'propose_update_field');
    expect(description).toContain(`Trial user (${a.trial.value})`);
    expect(description).toContain(`Nurturing (${a.nurturing.value})`);
    expect(description).toContain('Paying account (customer)');
    expect(description).not.toContain('Secret tier');
    expect(description).not.toContain('Subscriber');

    expect(reply.proposals.map((p) => p.request.body)).toEqual([{ lifecycleStage: a.trial.value }, { leadStatus: a.nurturing.value }]);
    expect(reply.proposals[0].summary).toContain('Trial user');
    expect(reply.proposals[0].summary).not.toContain(a.trial.value);
    // Proponer no escribe.
    const row = (await getDb().prepare('SELECT lifecycle_stage FROM crm_contacts WHERE id = ?').get(a.contact.id)) as { lifecycle_stage: string };
    expect(row.lifecycle_stage).not.toBe(a.trial.value);
  });

  it('una archivada o de otro workspace vuelve como error con las permitidas', async () => {
    const a = await workspace('c5-asst-arch');
    const b = await makeUser('c5-asst-arch-b');
    await addOption(b.id, 'lifecycle', 'Secret tier');
    const model = scriptedModel((i) =>
      i === 0
        ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'lifecycleStage', value: 'subscriber' } }
        : i === 1
          ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'lifecycleStage', value: 'Secret tier' } }
          : { text: 'Could not.' },
    );
    setAiModelOverride(model);
    const reply = await runAssistant({
      workspaceId: a.u.id,
      personId: a.u.id,
      scope: null,
      request: { messages: [{ role: 'user', content: 'Set lifecycle' }], locale: 'en' },
    });
    expect(reply.proposals).toHaveLength(0);
    const results = JSON.stringify(model.doGenerateCalls[2].prompt);
    expect(results).toContain('invalid_field_or_value');
    const allowed = [...results.matchAll(/"allowed":\[(.*?)\]/g)].map((m) => m[1]);
    expect(allowed).toHaveLength(2);
    for (const list of allowed) {
      expect(list).toContain('Trial user');
      expect(list).toContain('Paying account');
      expect(list).not.toContain('Secret tier');
      expect(list).not.toContain('Subscriber');
    }
  });

  it('nombres en el idioma del pedido: una de fábrica por su nombre traducido', async () => {
    const a = await workspace('c5-asst-es');
    setAiModelOverride(
      scriptedModel((i) =>
        i === 0
          ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'lifecycleStage', value: 'Oportunidad' } }
          : { text: 'Listo.' },
      ),
    );
    const reply = await runAssistant({
      workspaceId: a.u.id,
      personId: a.u.id,
      scope: null,
      request: { messages: [{ role: 'user', content: 'Pasala a oportunidad' }], locale: 'es' },
    });
    expect(reply.proposals[0].request.body).toEqual({ lifecycleStage: 'opportunity' });
    expect(reply.proposals[0].summary).toContain('Oportunidad');
  });

  it('un member que no ve el registro no recibe propuesta aunque la opción exista', async () => {
    const a = await workspace('c5-asst-scope');
    setAiModelOverride(
      scriptedModel((i) =>
        i === 0
          ? { tool: 'propose_update_field', input: { recordType: 'contact', recordId: a.contact.id, field: 'lifecycleStage', value: 'Trial user' } }
          : { text: 'ok' },
      ),
    );
    const reply = await runAssistant({
      workspaceId: a.u.id,
      personId: 'member-x',
      scope: ['member-x'],
      request: { messages: [{ role: 'user', content: 'trial' }], locale: 'en' },
    });
    expect(reply.proposals).toHaveLength(0);
  });

  it('get_record muestra el nombre de la opción, no la clave', async () => {
    const a = await workspace('c5-ctx');
    await getDb().prepare('UPDATE crm_contacts SET lifecycle_stage = ?, lead_status = ? WHERE id = ?').run(a.trial.value, a.nurturing.value, a.contact.id);
    const ctx = await buildRecordContext(a.u.id, 'contact', a.contact.id, null);
    const props = ctx!.lines.find((l) => l.startsWith('Properties:'))!;
    expect(props).toContain('lifecycle Trial user');
    expect(props).toContain('lead status Nurturing');
    expect(props).not.toContain(a.trial.value);
  });
});

describe('propuestas tras una llamada: opciones del workspace', () => {
  it('el prompt lista las activas con nombre; se acepta el nombre y se aplica la clave', async () => {
    const a = await workspace('c5-fu');
    const b = await makeUser('c5-fu-b');
    await addOption(b.id, 'lifecycle', 'Secret tier');
    const call = await createActivity(a.u.id, { type: 'call', subject: 'Check-in', body: 'They started the trial.', contactId: a.contact.id });
    const model = mockModel(
      JSON.stringify({
        fields: [
          { key: 'contact:lifecycleStage', value: 'Trial user', reason: 'Started the trial' },
          { key: 'contact:leadStatus', value: 'subscriber', reason: 'archived is not an option here' },
        ],
        stage: null,
        email: null,
        tasks: [],
      }),
    );
    setAiModelOverride(model);
    const owner: FieldViewer = { workspaceId: a.u.id, personId: a.u.id, role: 'owner' };
    const items = await generateFollowups({ workspaceId: a.u.id, viewer: owner, activityId: call.id, scope: null, locale: 'en' });

    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain(`Trial user (${a.trial.value})`);
    expect(prompt).toContain(`Nurturing (${a.nurturing.value})`);
    expect(prompt).not.toContain('Secret tier');
    expect(prompt).not.toContain('Subscriber (subscriber)');

    const fields = items.filter((i) => i.kind === 'field');
    expect(fields.map((i) => [i.field!.key, i.field!.value])).toEqual([['lifecycleStage', a.trial.value]]);
    expect(fields[0].field!.options).not.toContain('subscriber');
    expect(fields[0].field!.options).toContain(a.trial.value);

    await applyFieldFollowup({ workspaceId: a.u.id, viewer: owner, scope: null, id: fields[0].id, actorEmail: 'owner@example.test', locale: 'en' });
    const row = (await getDb().prepare('SELECT lifecycle_stage FROM crm_contacts WHERE id = ?').get(a.contact.id)) as { lifecycle_stage: string };
    expect(row.lifecycle_stage).toBe(a.trial.value);
  });
});
