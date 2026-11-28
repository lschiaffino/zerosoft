import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAiModelOverride } from '@/lib/ai';
import { getDb } from '@/lib/db';
import { createActivity, createContact, createCustomField, createDeal, createPipeline, createStage, getDeal } from '@/lib/crm';
import { setFieldPermissions, type FieldViewer } from '@/lib/crm-field-perms';
import {
  applyFieldFollowup,
  coerceProposalValue,
  generateFollowups,
  listFollowups,
  markFollowup,
  normalizeFollowup,
  type FieldOption,
} from '@/lib/crm-ai-followup';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

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

/** Workspace con un deal en la primera de tres etapas, un contacto y una llamada. */
async function setup(prefix: string) {
  const u = await makeUser(prefix);
  const p = await createPipeline(u.id, `P ${tag()}`);
  const discovery = (await createStage(u.id, p.id, { name: 'Discovery', probability: 20 }))!;
  const proposal = (await createStage(u.id, p.id, { name: 'Proposal', probability: 50 }))!;
  const won = (await createStage(u.id, p.id, { name: 'Won', probability: 100 }))!;
  await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(won.id);
  const hidden = await createCustomField(u.id, { entity: 'deals', name: `secret_${tag()}`, label: 'Budget code', type: 'text' });
  const readonly = await createCustomField(u.id, { entity: 'deals', name: `ro_${tag()}`, label: 'Region', type: 'text' });
  const open = await createCustomField(u.id, { entity: 'deals', name: `comp_${tag()}`, label: 'Competitor', type: 'text' });
  await setFieldPermissions(u.id, hidden.id, [{ subject: 'role:member', access: 'hidden' }]);
  await setFieldPermissions(u.id, readonly.id, [{ subject: 'role:member', access: 'read' }]);
  const contact = await createContact(u.id, { firstName: 'Ana', lastName: 'Gómez', email: `ana-${tag()}@acme.test` });
  const res = await createDeal(u.id, {
    pipelineId: p.id,
    stageId: discovery.id,
    name: 'Acme renewal',
    amount: 5000,
    contactIds: [contact.id],
    custom: { [hidden.name]: 'BX-77-CLASSIFIED', [readonly.name]: 'South' },
  });
  if (!res.ok) throw new Error(res.reason);
  const call = await createActivity(u.id, {
    type: 'call',
    subject: 'Pricing call',
    body: 'Budget approved at 9000. Competitor: Rival Co. We will send the contract on Monday.',
    contactId: contact.id,
    dealId: res.deal.id,
  });
  const member: FieldViewer = { workspaceId: u.id, personId: `member-${tag()}`, role: 'member' };
  const owner: FieldViewer = { workspaceId: u.id, personId: u.id, role: 'owner' };
  return { u, deal: res.deal, contact, call, hidden, readonly, open, discovery, proposal, won, member, owner };
}

function modelOutput(s: Awaited<ReturnType<typeof setup>>) {
  return JSON.stringify({
    fields: [
      { key: 'deal:amount', value: '$9,000', reason: 'Budget approved at 9000' },
      { key: `deal:custom:${s.hidden.name}`, value: 'leak', reason: 'x' },
      { key: `deal:custom:${s.readonly.name}`, value: 'North', reason: 'x' },
      { key: `deal:custom:${s.open.name}`, value: 'Rival Co', reason: 'Competitor: Rival Co' },
      { key: 'deal:priority', value: 'urgent', reason: 'not an option' },
      { key: 'contact:email', value: 'x@y.test', reason: 'not proposable' },
    ],
    stage: { stage: 'proposal', reason: 'They asked for the contract' },
    email: { subject: 'Next steps', body: 'Hi Ana,\n\nThanks for the call.' },
    tasks: [
      { title: 'Send the contract', dueInDays: 3 },
      { title: 'send the contract', dueInDays: 1 },
      { title: 'Call legal', dueInDays: 99 },
    ],
  });
}

describe('IA tras una llamada', () => {
  it('un member: el campo oculto no llega al modelo ni se propone; solo lo que puede editar', async () => {
    const s = await setup('fu-member');
    const model = mockModel(modelOutput(s));
    setAiModelOverride(model);
    const items = await generateFollowups({ workspaceId: s.u.id, viewer: s.member, activityId: s.call.id, scope: null, locale: 'en' });

    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).not.toContain(s.hidden.name);
    expect(prompt).not.toContain('Budget code');
    expect(prompt).not.toContain('BX-77-CLASSIFIED');
    // Solo lectura: tampoco se manda (no se puede proponer).
    expect(prompt).not.toContain(s.readonly.name);
    expect(prompt).toContain(`deal:custom:${s.open.name}`);

    const fields = items.filter((i) => i.kind === 'field').map((i) => [i.field!.key, i.field!.value]);
    expect(fields).toEqual([
      ['amount', 9000],
      [`custom:${s.open.name}`, 'Rival Co'],
    ]);
    const stage = items.find((i) => i.kind === 'stage')!;
    expect(stage.stage).toMatchObject({ stageId: s.proposal.id, fromStageName: 'Discovery', stageName: 'Proposal' });
    expect(items.find((i) => i.kind === 'email')!.email).toMatchObject({ recordType: 'contact', recordId: s.contact.id, to: s.contact.email });
    expect(items.filter((i) => i.kind === 'task').map((i) => [i.task!.title, i.task!.dueInDays])).toEqual([
      ['Send the contract', 3],
      ['Call legal', 30],
    ]);
    expect(JSON.stringify(items)).not.toContain('BX-77-CLASSIFIED');

    // Otra persona no ve las propuestas de esta.
    const other: FieldViewer = { ...s.member, personId: `other-${tag()}` };
    expect((await listFollowups({ workspaceId: s.u.id, viewer: other, activityId: s.call.id, scope: null, locale: 'en' })).items).toEqual([]);
  });

  it('aplicar una propiedad: mezcla el custom sin pisar los ocultos, una sola vez', async () => {
    const s = await setup('fu-apply');
    setAiModelOverride(mockModel(modelOutput(s)));
    const items = await generateFollowups({ workspaceId: s.u.id, viewer: s.member, activityId: s.call.id, scope: null, locale: 'en' });
    const comp = items.find((i) => i.field?.key === `custom:${s.open.name}`)!;
    const amount = items.find((i) => i.field?.key === 'amount')!;

    // Editada antes de aplicar.
    await applyFieldFollowup({ workspaceId: s.u.id, viewer: s.member, scope: null, id: comp.id, value: 'Rival Inc', actorEmail: 'm@x.test', locale: 'en' });
    await applyFieldFollowup({ workspaceId: s.u.id, viewer: s.member, scope: null, id: amount.id, actorEmail: 'm@x.test', locale: 'en' });
    const deal = (await getDeal(s.u.id, s.deal.id))!.deal;
    expect(deal.amount).toBe(9000);
    expect(JSON.parse(deal.custom)).toMatchObject({ [s.open.name]: 'Rival Inc', [s.hidden.name]: 'BX-77-CLASSIFIED', [s.readonly.name]: 'South' });

    await expect(
      applyFieldFollowup({ workspaceId: s.u.id, viewer: s.member, scope: null, id: amount.id, actorEmail: 'm@x.test', locale: 'en' }),
    ).rejects.toMatchObject({ code: 'already_done' });
    // Otra persona no aplica propuestas ajenas.
    const other: FieldViewer = { ...s.member, personId: `other-${tag()}` };
    await expect(markFollowup(s.u.id, other.personId, comp.id, 'discarded')).rejects.toMatchObject({ code: 'not_found' });
    // Una propiedad solo se aplica por el server.
    const task = items.find((i) => i.kind === 'task')!;
    await expect(markFollowup(s.u.id, s.member.personId, amount.id, 'applied')).rejects.toMatchObject({ code: 'invalid_input' });
    await markFollowup(s.u.id, s.member.personId, task.id, 'discarded');
    const after = await listFollowups({ workspaceId: s.u.id, viewer: s.member, activityId: s.call.id, scope: null, locale: 'en' });
    expect(after.items.find((i) => i.id === task.id)).toBeUndefined();
    expect(after.items.find((i) => i.id === amount.id)?.status).toBe('applied');
  });

  it('si el campo pasa a oculto después, la propuesta ya no sale ni se aplica', async () => {
    const s = await setup('fu-later');
    setAiModelOverride(mockModel(modelOutput(s)));
    const items = await generateFollowups({ workspaceId: s.u.id, viewer: s.member, activityId: s.call.id, scope: null, locale: 'en' });
    const comp = items.find((i) => i.field?.key === `custom:${s.open.name}`)!;
    await setFieldPermissions(s.u.id, s.open.id, [{ subject: 'role:member', access: 'hidden' }]);
    const list = await listFollowups({ workspaceId: s.u.id, viewer: s.member, activityId: s.call.id, scope: null, locale: 'en' });
    expect(list.items.some((i) => i.id === comp.id)).toBe(false);
    await expect(
      applyFieldFollowup({ workspaceId: s.u.id, viewer: s.member, scope: null, id: comp.id, actorEmail: 'm@x.test', locale: 'en' }),
    ).rejects.toMatchObject({ code: 'field_readonly' });
  });

  it('el owner ve todos los campos; sin notas no hay propuestas', async () => {
    const s = await setup('fu-owner');
    const model = mockModel(modelOutput(s));
    setAiModelOverride(model);
    const items = await generateFollowups({ workspaceId: s.u.id, viewer: s.owner, activityId: s.call.id, scope: null, locale: 'en' });
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain('Budget code');
    expect(items.some((i) => i.field?.key === `custom:${s.hidden.name}`)).toBe(true);

    const empty = await createActivity(s.u.id, { type: 'meeting', subject: '', body: '', dealId: s.deal.id });
    await expect(generateFollowups({ workspaceId: s.u.id, viewer: s.owner, activityId: empty.id, scope: null, locale: 'en' })).rejects.toMatchObject({
      code: 'no_content',
    });
    const note = await createActivity(s.u.id, { type: 'note', subject: 'x', body: 'A note, not a call, long enough.', dealId: s.deal.id });
    await expect(generateFollowups({ workspaceId: s.u.id, viewer: s.owner, activityId: note.id, scope: null, locale: 'en' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('normalizeFollowup y coerceProposalValue', () => {
  const opt = (o: Partial<FieldOption>): FieldOption => ({
    entity: 'deal',
    recordId: 'd1',
    recordName: 'D',
    key: 'amount',
    label: 'Amount',
    type: 'currency',
    options: [],
    current: 100,
    ...o,
  });

  it('valida tipos y descarta lo igual al valor actual', () => {
    expect(coerceProposalValue(opt({}), '€ 1.500')).toBe(1.5);
    expect(coerceProposalValue(opt({ type: 'date', key: 'closeDate' }), '2026-13-40')).toBeNull();
    expect(coerceProposalValue(opt({ type: 'date', key: 'closeDate' }), '2026-12-15')).toBe('2026-12-15');
    expect(coerceProposalValue(opt({ type: 'select', key: 'priority', options: ['low', 'high'] }), 'HIGH')).toBe('high');
    expect(coerceProposalValue(opt({ type: 'boolean', key: 'custom:ok' }), 'true')).toBe(true);
    const out = normalizeFollowup(
      { fields: [{ key: 'deal:amount', value: '100', reason: '' }, { key: 'deal:nope', value: '1', reason: '' }], stage: null, email: null, tasks: [] },
      { catalog: [opt({})], stage: null, email: null, links: { contactId: null, companyId: null, dealId: 'd1' } },
    );
    expect(out).toEqual([]);
  });

  it('la etapa solo avanza a una etapa abierta posterior; sin destinatario no hay email', () => {
    const ctx = {
      catalog: [],
      stage: { dealId: 'd1', dealName: 'D', currentStageId: 's1', currentStageName: 'One', forward: [{ id: 's2', name: 'Two' }] },
      email: null,
      links: { contactId: null, companyId: null, dealId: 'd1' },
    };
    expect(normalizeFollowup({ fields: [], stage: { stage: 'One', reason: '' }, email: { subject: 'a', body: 'b' }, tasks: [] }, ctx)).toEqual([]);
    expect(normalizeFollowup({ fields: [], stage: { stage: 'two', reason: 'r' }, email: null, tasks: [] }, ctx)).toEqual([
      { kind: 'stage', payload: { dealId: 'd1', dealName: 'D', stageId: 's2', stageName: 'Two' }, reason: 'r' },
    ]);
  });
});
