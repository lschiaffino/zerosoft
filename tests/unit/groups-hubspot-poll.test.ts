import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { chatCompany, syncHubspotCompanies } from '@/lib/groups-hubspot-sync';
import { editFakeCompany, fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { makeUser } from './helpers';

const TOKEN = 'pat-na1-fake-token-for-poll';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => vi.unstubAllEnvs());

async function line(ws: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name: 'Clientes' });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

let seq = 0;
async function group(ws: string, row: Awaited<ReturnType<typeof line>>, name: string) {
  seq += 1;
  await ingestEvents(row, [
    { type: 'message' as const, chatId: `12036399${String(seq).padStart(6, '0')}@g.us`, isGroup: true, chatName: name, fromMe: false, senderPhone: '5491100000009', senderName: 'Cliente', providerMessageId: `poll-${seq}-${Math.random().toString(36).slice(2, 8)}`, body: 'Hola' },
  ]);
  return (await listChats(ws, ws, { limit: 500 })).rows.find((r) => r.name === name)!;
}

const cron = (ws: string, minutes = 0) => syncHubspotCompanies({ workspaceId: ws, now: new Date(Date.now() + minutes * 60_000) });

async function linkProps(ws: string, chatId: string, type: string): Promise<Record<string, unknown>> {
  const row = (await getDb().prepare('SELECT name, props, missing FROM groups_hubspot_links WHERE user_id = ? AND chat_id = ? AND object_type = ?').get(ws, chatId, type)) as {
    name: string;
    props: string;
    missing: number;
  };
  return { name: row.name, missing: row.missing, ...JSON.parse(row.props) };
}

describe('HubSpot → Lines: contactos y negocios vinculados', () => {
  it('el cron trae el cambio de etapa de un negocio y el nombre de un contacto sin abrir el chat', async () => {
    const owner = await makeUser('poll-obj-ws');
    const row = await line(owner.id);
    const g = await group(owner.id, row, 'Poll uno');
    await connectHubspot(owner.id, owner.id, TOKEN);
    await linkHubspot(owner.id, owner.id, g.id, 'deal', '8001');
    await linkHubspot(owner.id, owner.id, g.id, 'contact', '7001');
    await cron(owner.id);
    const before = await linkProps(owner.id, g.id, 'deal');
    fakeHubspot().edit('deals', '8001', { dealstage: 'closedwon', dealname: 'Piloto renovado' });
    fakeHubspot().edit('contacts', '7001', { firstname: 'Renombrada' });
    const res = await cron(owner.id, 1);
    expect(res.changed).toBeGreaterThanOrEqual(2);
    const deal = await linkProps(owner.id, g.id, 'deal');
    expect(deal.name).toBe('Piloto renovado');
    expect(deal.stage).toBe('Closed won');
    expect(deal.stage).not.toBe(before.stage);
    expect((await linkProps(owner.id, g.id, 'contact')).name).toContain('Renombrada');
    // Sin cambios, la corrida siguiente no vuelve a leer nada.
    fakeHubspot().calls.length = 0;
    await cron(owner.id, 2);
    expect(fakeHubspot().calls.filter((c) => c.path.endsWith('/batch/read') && /deals|contacts/.test(c.path))).toHaveLength(0);
  });

  it('un negocio borrado en HubSpot queda marcado en la verificación de cada hora; el cursor retoma por tandas', async () => {
    const owner = await makeUser('poll-del-ws');
    const row = await line(owner.id);
    const g = await group(owner.id, row, 'Poll dos');
    await connectHubspot(owner.id, owner.id, TOKEN);
    await linkHubspot(owner.id, owner.id, g.id, 'deal', '8001');
    await cron(owner.id);
    fakeHubspot().objects.deals.delete('8001');
    expect((await linkProps(owner.id, g.id, 'deal')).missing).toBe(0);
    await cron(owner.id, 61);
    await cron(owner.id, 62);
    expect((await linkProps(owner.id, g.id, 'deal')).missing).toBe(1);
    const cursor = JSON.parse(((await getDb().prepare('SELECT sync_cursor FROM groups_hubspot WHERE user_id = ?').get(owner.id)) as { sync_cursor: string }).sync_cursor);
    expect(cursor.obj.deal.since).toBeTruthy();
  });

  it('otro workspace no recibe lo de este', async () => {
    const a = await makeUser('poll-iso-a');
    const b = await makeUser('poll-iso-b');
    const ga = await group(a.id, await line(a.id), 'Poll iso a');
    const gb = await group(b.id, await line(b.id), 'Poll iso b');
    await connectHubspot(a.id, a.id, TOKEN);
    await connectHubspot(b.id, b.id, TOKEN);
    await linkHubspot(a.id, a.id, ga.id, 'deal', '8001');
    await cron(a.id);
    await cron(b.id);
    fakeHubspot().edit('deals', '8001', { dealname: 'Solo para A' });
    await cron(a.id, 1);
    await cron(b.id, 1);
    expect((await linkProps(a.id, ga.id, 'deal')).name).toBe('Solo para A');
    const rows = (await getDb().prepare("SELECT COUNT(*) AS n FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'deal'").get(b.id)) as { n: number };
    expect(rows.n).toBe(0);
    expect(gb.id).not.toBe(ga.id);
  });
});

describe('HubSpot: fusión de empresas', () => {
  it('con un solo ganador el grupo pasa a la empresa que quedó, con sus valores', async () => {
    const owner = await makeUser('poll-merge-ws');
    const row = await line(owner.id);
    const g = await group(owner.id, row, 'Poll merge');
    await connectHubspot(owner.id, owner.id, TOKEN);
    await linkHubspot(owner.id, owner.id, g.id, 'company', '9003');
    await cron(owner.id);
    fakeHubspot().merge('companies', '9003', '9002');
    editFakeCompany('9002', { city: 'Lima' });
    await getDb().prepare('UPDATE groups_hubspot SET verified_at = ? WHERE user_id = ?').run(new Date(Date.now() - 2 * 3_600_000).toISOString(), owner.id);
    await cron(owner.id, 1);
    const dto = await chatCompany(owner.id, g.id, { refresh: 'none' });
    expect(dto.company).toMatchObject({ id: '9002', broken: null });
    expect(dto.values.city).toBe('Lima');
  });

  it('si dos empresas dicen haber absorbido a la borrada no se adivina: queda el aviso para vincular a mano', async () => {
    const owner = await makeUser('poll-amb-ws');
    const row = await line(owner.id);
    const g = await group(owner.id, row, 'Poll ambiguo');
    await connectHubspot(owner.id, owner.id, TOKEN);
    await linkHubspot(owner.id, owner.id, g.id, 'company', '9003');
    await cron(owner.id);
    fakeHubspot().companies.delete('9003');
    editFakeCompany('9001', { hs_merged_object_ids: '9003' });
    editFakeCompany('9002', { hs_merged_object_ids: '9003' });
    await getDb().prepare('UPDATE groups_hubspot SET verified_at = ? WHERE user_id = ?').run(new Date(Date.now() - 2 * 3_600_000).toISOString(), owner.id);
    await cron(owner.id, 1);
    const dto = await chatCompany(owner.id, g.id, { refresh: 'none' });
    expect(dto.company).toMatchObject({ id: '9003' });
    expect(dto.company?.broken?.reason).toBe('merged');
  });
});
