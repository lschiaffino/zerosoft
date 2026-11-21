import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createActivity, createCompany, createContact, createDeal, createPipeline, createStage } from '@/lib/crm';
import { ownerScopeFor, setMemberVisibility } from '@/lib/crm-visibility';
import { listRecordActivities, listRecordChats, pinOnRecord, visibleEmailContacts } from '@/lib/crm-timeline';
import { noChatReader, sessionChatReader } from '@/lib/crm-chat-privacy';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { setLineAccess } from '@/lib/groups-lines';
import { createGroupTask } from '@/lib/groups-tasks';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/**
 * Timeline de la ficha (lib/crm-timeline.ts): actividad de asociados, paginado, fijada por registro y la
 * privacidad en cada lectura (visibilidad por owner, tareas de chats de Lines, emails y chats). Textos inventados.
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

async function crmWorld(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  // La empresa y el contacto A son del member; el contacto B, del dueño.
  const company = await createCompany(ws, { name: `${label} Co`, ownerId: w.member.id });
  const a = await createContact(ws, { firstName: 'Ana', lastName: label, companyId: company.id, ownerId: w.member.id });
  const b = await createContact(ws, { firstName: 'Beto', lastName: label, companyId: company.id, ownerId: ws });
  const p = await createPipeline(ws, `P ${label}`);
  const stage = (await createStage(ws, p.id, { name: 'Open', probability: 20 }))!;
  const dealRes = await createDeal(ws, { pipelineId: p.id, stageId: stage.id, name: `${label} Deal`, companyId: company.id, contactIds: [a.id], ownerId: w.member.id });
  if (!dealRes.ok) throw new Error('deal');
  const deal = dealRes.deal;
  const onCompany = await createActivity(ws, { type: 'note', body: 'zq note on company', companyId: company.id });
  const onA = await createActivity(ws, { type: 'call', subject: 'zq call with Ana', contactId: a.id });
  const onB = await createActivity(ws, { type: 'note', body: 'zq secret note on Beto', contactId: b.id });
  const onDeal = await createActivity(ws, { type: 'meeting', subject: 'zq deal meeting', dealId: deal.id });
  return { ...w, ws, company, a, b, deal, onCompany, onA, onB, onDeal };
}

describe('crm record timeline', () => {
  it('company: its own activity plus its contacts and deals, flagged as associated; hiding them leaves its own', async () => {
    const w = await crmWorld('tl-rollup');
    const all = await listRecordActivities(w.ws, { kind: 'company', id: w.company.id });
    const byId = new Map(all.rows.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual([w.onCompany.id, w.onA.id, w.onB.id, w.onDeal.id].sort());
    expect(byId.get(w.onCompany.id)?.rollup).toBe(0);
    expect(byId.get(w.onA.id)?.rollup).toBe(1);
    expect(byId.get(w.onDeal.id)?.rollup).toBe(1);
    const own = await listRecordActivities(w.ws, { kind: 'company', id: w.company.id }, { includeAssociated: false });
    expect(own.rows.map((r) => r.id)).toEqual([w.onCompany.id]);
  });

  it('deal: its own activity plus its contacts and its company; contact: only its own', async () => {
    const w = await crmWorld('tl-deal');
    const deal = await listRecordActivities(w.ws, { kind: 'deal', id: w.deal.id });
    expect(deal.rows.map((r) => r.id).sort()).toEqual([w.onDeal.id, w.onA.id, w.onCompany.id].sort());
    expect(deal.rows.find((r) => r.id === w.onDeal.id)?.rollup).toBe(0);
    const contact = await listRecordActivities(w.ws, { kind: 'contact', id: w.a.id });
    expect(contact.rows.map((r) => r.id)).toEqual([w.onA.id]);
  });

  it('a member with "mine" visibility does not get the activity of a contact they cannot see in the rollup', async () => {
    const w = await crmWorld('tl-scope');
    await setMemberVisibility(w.ws, 'mine');
    const scope = await ownerScopeFor({ workspaceId: w.ws, personId: w.member.id, role: 'member' });
    const member = await listRecordActivities(w.ws, { kind: 'company', id: w.company.id }, { ownerScope: scope });
    const ids = member.rows.map((r) => r.id);
    expect(ids).toContain(w.onA.id);
    expect(ids).not.toContain(w.onB.id);
    expect(JSON.stringify(member.rows)).not.toContain('zq secret note on Beto');
    // El dueño ve todo.
    const owner = await listRecordActivities(w.ws, { kind: 'company', id: w.company.id }, { ownerScope: null });
    expect(owner.rows.map((r) => r.id)).toContain(w.onB.id);
    // Y los emails de la empresa salen solo de los contactos que ve.
    expect(await visibleEmailContacts(w.ws, { kind: 'company', id: w.company.id }, scope)).toEqual([w.a.id]);
    expect((await visibleEmailContacts(w.ws, { kind: 'company', id: w.company.id }, null)).sort()).toEqual([w.a.id, w.b.id].sort());
    expect(await visibleEmailContacts(w.ws, { kind: 'contact', id: w.b.id }, scope)).toEqual([]);
  });

  it('pagination: 100 per page with hasMore, the rest on the next offset, no repeats', async () => {
    const w = await workspaceWithMember('tl-page');
    const c = await createContact(w.owner.id, { firstName: 'Paged' });
    for (let i = 0; i < 105; i++) await createActivity(w.owner.id, { type: 'note', body: `zq n${i}`, contactId: c.id });
    const p1 = await listRecordActivities(w.owner.id, { kind: 'contact', id: c.id });
    expect(p1.rows).toHaveLength(100);
    expect(p1.hasMore).toBe(true);
    const p2 = await listRecordActivities(w.owner.id, { kind: 'contact', id: c.id }, { offset: 100 });
    expect(p2.rows).toHaveLength(5);
    expect(p2.hasMore).toBe(false);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(105);
  });

  it('pin: one per record, only own activities, and a contact pin does not float on the company', async () => {
    const w = await crmWorld('tl-pin');
    const second = await createActivity(w.ws, { type: 'note', body: 'zq second', companyId: w.company.id });
    expect(await pinOnRecord(w.ws, w.onCompany.id, { kind: 'company', id: w.company.id }, true)).toBe(true);
    expect(await pinOnRecord(w.ws, second.id, { kind: 'company', id: w.company.id }, true)).toBe(true);
    const rows = (await listRecordActivities(w.ws, { kind: 'company', id: w.company.id })).rows;
    expect(rows[0].id).toBe(second.id);
    expect(rows.filter((r) => r.pinned).map((r) => r.id)).toEqual([second.id]);
    // Una actividad de un contacto no se fija desde la empresa.
    expect(await pinOnRecord(w.ws, w.onA.id, { kind: 'company', id: w.company.id }, true)).toBe(false);
    // Fijada en el contacto: en la empresa queda sin fijar.
    await pinOnRecord(w.ws, w.onA.id, { kind: 'contact', id: w.a.id }, true);
    const again = (await listRecordActivities(w.ws, { kind: 'company', id: w.company.id })).rows;
    expect(again.find((r) => r.id === w.onA.id)?.pinned).toBe(0);
    expect((await listRecordActivities(w.ws, { kind: 'contact', id: w.a.id })).rows[0].pinned).toBe(1);
    // Una actividad del contacto que también es de la empresa, fijada desde el contacto: la empresa sigue con una sola.
    const both = await createActivity(w.ws, { type: 'note', body: 'zq both', contactId: w.a.id, companyId: w.company.id });
    await pinOnRecord(w.ws, both.id, { kind: 'contact', id: w.a.id }, true);
    const company = (await listRecordActivities(w.ws, { kind: 'company', id: w.company.id })).rows;
    expect(company.filter((r) => r.pinned).map((r) => r.id)).toEqual([both.id]);
  });

  it('author: the owner of the activity, or the workspace owner when it has none', async () => {
    const w = await crmWorld('tl-author');
    const mine = await createActivity(w.ws, { type: 'note', body: 'zq by member', contactId: w.a.id, ownerId: w.member.id });
    const rows = (await listRecordActivities(w.ws, { kind: 'contact', id: w.a.id })).rows;
    expect(rows.find((r) => r.id === mine.id)?.author_id).toBe(w.member.id);
    expect(rows.find((r) => r.id === w.onA.id)?.author_id).toBe(w.ws);
  });
});

describe('crm record timeline and Lines', () => {
  const PERSON = '5491155550188';

  async function chatWorld(label: string) {
    const w = await crmWorld(label);
    const n = await createNumber(w.ws, w.ws, { provider: 'fake', name: 'Linea' });
    await connectNumber(w.ws, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    const line = (await getNumberRowById(n.id))!;
    await ingestEvents(line, [
      { type: 'message' as const, chatId: `${PERSON}@c.us`, isGroup: false, fromMe: false, senderPhone: PERSON, senderName: 'Cliente', providerMessageId: `${label}-m1`, body: 'zq whatsapp text' },
    ]);
    // Solo `friend` ve la línea.
    await setLineAccess(w.ws, line.id, { ownerId: w.ws, visibility: 'restricted', personIds: [w.friend.id], teamIds: [] });
    const chat = (await getDb().prepare('SELECT id FROM groups_chats WHERE user_id = ? AND number_id = ?').get(w.ws, line.id)) as { id: string };
    await getDb().prepare('UPDATE groups_chats SET crm_contact_id = ? WHERE id = ?').run(w.a.id, chat.id);
    // Una tarea del chat, vinculada al contacto A (aparece en la empresa como asociada).
    const task = await createGroupTask(w.ws, w.friend.id, { chatId: chat.id, title: 'zq chat task title', notes: 'zq chat task notes', ownerId: w.member.id });
    await getDb().prepare('UPDATE crm_activities SET contact_id = ? WHERE id = ?').run(w.a.id, task.activityId);
    return { ...w, chatId: chat.id, taskId: task.activityId };
  }

  it('a chat task rolled up to the company keeps its text hidden from who cannot see the chat', async () => {
    const w = await chatWorld('tl-chat-task');
    const memberReader = await sessionChatReader(asMember(w.owner, w.member), 'en');
    const friendReader = await sessionChatReader(asMember(w.owner, w.friend), 'en');
    const hidden = (await listRecordActivities(w.ws, { kind: 'company', id: w.company.id }, { chatReader: memberReader })).rows;
    const row = hidden.find((r) => r.id === w.taskId)!;
    expect(row.rollup).toBe(1);
    expect(row.chat_private).toBe(1);
    expect(JSON.stringify(hidden)).not.toContain('zq chat task');
    const seen = (await listRecordActivities(w.ws, { kind: 'company', id: w.company.id }, { chatReader: friendReader })).rows;
    expect(seen.find((r) => r.id === w.taskId)?.subject).toBe('zq chat task title');
  });

  it('WhatsApp chats on the contact timeline follow Lines visibility', async () => {
    const w = await chatWorld('tl-chat-items');
    const rec = { kind: 'contact' as const, id: w.a.id };
    const friend = await listRecordChats(w.ws, rec, { personId: w.friend.id, role: 'member' }, await sessionChatReader(asMember(w.owner, w.friend), 'en'));
    expect(friend).toHaveLength(1);
    expect(friend[0].type).toBe('whatsapp');
    expect(friend[0].wa.messages.map((m) => m.text)).toContain('zq whatsapp text');
    // Sin la línea: nada.
    const member = await listRecordChats(w.ws, rec, { personId: w.member.id, role: 'member' }, await sessionChatReader(asMember(w.owner, w.member), 'en'));
    expect(member).toEqual([]);
    // Sin la app Lines: nada.
    const noLines = await listRecordChats(w.ws, rec, { personId: w.friend.id, role: 'member' }, noChatReader(w.ws));
    expect(noLines).toEqual([]);
    // El dueño ve el chat; los deals no tienen chats.
    const owner = await listRecordChats(w.ws, rec, { personId: w.ws, role: 'owner' }, await sessionChatReader(asOwner(w.owner), 'en'));
    expect(owner).toHaveLength(1);
    expect(await listRecordChats(w.ws, { kind: 'deal', id: w.deal.id }, { personId: w.ws, role: 'owner' }, null)).toEqual([]);
  });
});
