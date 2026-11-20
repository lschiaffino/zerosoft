import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { connectHubspot, linkHubspot } from '@/lib/groups-hubspot';
import { createHubspotTicket, hubspotTicketPipelines } from '@/lib/groups-hubspot-tickets';
import { createTicket, getTicket } from '@/lib/groups-tickets';
import { fakeHubspot, resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { makeUser } from './helpers';

/** Lines: "Crear ticket en HubSpot" desde un chat o un ticket (lib/groups-hubspot-tickets.ts). Datos inventados. */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));
const route = await import('@/app/api/groups/hubspot/tickets/route');

const TOKEN = 'pat-na1-fake-token-for-tests';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('GROUPS_INTEGRATIONS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
  resetFakeHubspot();
});
afterEach(() => {
  session.user = null;
});

async function world(label: string) {
  const owner = await makeUser(`${label}-ws`);
  const n = await createNumber(owner.id, owner.id, { provider: 'fake', name: 'Ventas' });
  await connectNumber(owner.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [
    {
      type: 'message' as const,
      chatId: `1203631${label.length}@g.us`,
      isGroup: true,
      chatName: 'Grupo Acme',
      fromMe: false,
      senderPhone: '5491100000009',
      senderName: 'Dana',
      providerMessageId: `${label}-g1`,
      body: 'No llega la factura',
    },
  ]);
  await connectHubspot(owner.id, owner.id, TOKEN);
  const group = (await listChats(owner.id, owner.id)).rows.find((r) => r.kind === 'group')!;
  return { owner, group };
}

const ticketPosts = () => fakeHubspot().calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/tickets');

describe('HubSpot: tickets desde Lines', () => {
  it('lee los pipelines y crea el ticket asociado a la empresa y el negocio del chat', async () => {
    const w = await world('hst-a');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'company', '9001');
    await linkHubspot(w.owner.id, w.owner.id, w.group.id, 'deal', '8001');
    const pipes = await hubspotTicketPipelines(w.owner.id);
    expect(pipes[0]).toMatchObject({ id: '0', stages: expect.arrayContaining([expect.objectContaining({ id: '4', closed: true })]) });

    const res = await createHubspotTicket(w.owner.id, w.group.id, { subject: '  No llega   la factura ', content: 'Detalle', priority: 'high' });
    expect(res.created).toBe(true);
    expect(res.url).toMatch(new RegExp(`/record/0-5/${res.id}$`));
    const [post] = ticketPosts();
    expect(post.body).toMatchObject({ properties: { subject: 'No llega la factura', content: 'Detalle', hs_pipeline: '0', hs_pipeline_stage: '1', hs_ticket_priority: 'HIGH' } });
    expect(fakeHubspot().associated('tickets', res.id, 'companies').map((a) => String(a.toObjectId))).toEqual(['9001']);
    expect(fakeHubspot().associated('tickets', res.id, 'deals').map((a) => String(a.toObjectId))).toEqual(['8001']);
  });

  it('desde un ticket de Lines: guarda el vínculo y no lo crea dos veces', async () => {
    const w = await world('hst-b');
    const { ticket } = await createTicket(w.owner.id, w.owner.id, { chatId: w.group.id, title: 'Factura' });
    const first = await createHubspotTicket(w.owner.id, w.group.id, { subject: 'Factura', linesTicketId: ticket.id, stage: '3' });
    expect(first.created).toBe(true);
    expect(ticketPosts()[0].body).toMatchObject({ properties: { hs_pipeline_stage: '3' }, associations: [] });
    expect((await getTicket(w.owner.id, ticket.id))?.hubspotTicketId).toBe(first.id);
    const again = await createHubspotTicket(w.owner.id, w.group.id, { subject: 'Otra vez', linesTicketId: ticket.id });
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(ticketPosts()).toHaveLength(1);
    await expect(createHubspotTicket(w.owner.id, w.group.id, { subject: '   ' })).rejects.toMatchObject({ code: 'invalid_title' });
  });

  it('la ruta pide sesión y no deja usar un chat de otro workspace', async () => {
    const w = await world('hst-c');
    const other = await makeUser('hst-c-other');
    const post = (body: unknown) => route.POST(new Request('http://x.test/api/groups/hubspot/tickets', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    expect((await post({ chatId: w.group.id, subject: 'x' })).status).toBe(401);
    session.user = { ...other, role: 'owner' };
    expect([403, 404]).toContain((await post({ chatId: w.group.id, subject: 'x' })).status);
    session.user = { ...w.owner, role: 'owner' };
    const ok = await post({ chatId: w.group.id, subject: 'Desde la ruta' });
    expect(ok.status).toBe(201);
    expect(ticketPosts()).toHaveLength(1);
  });
});
