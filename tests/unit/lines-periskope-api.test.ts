import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listPropertyDefs } from '@/lib/groups';
import { listTickets } from '@/lib/groups-tickets';
import {
  importPeriskopeApi,
  periskopeFetcher,
  propertyCell,
  propertyTypeFrom,
  ticketPriorityFrom,
  ticketStatusFrom,
  type PeriskopeFetch,
} from '@/lib/groups-periskope-api';
import { fakePeriskope } from '@/lib/groups-periskope-fake';
import { makeUser } from './helpers';

/** Lines › Ajustes › Migrar con la API de Periskope (lib/groups-periskope-api.ts). Datos inventados. */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function line(ws: string, name: string, phone: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  await getDb().prepare("UPDATE groups_numbers SET phone = ?, status = 'connected' WHERE id = ?").run(phone, n.id);
  return (await getNumberRowById(n.id))!;
}

async function teamOf(ownerId: string): Promise<string> {
  const db = getDb();
  const team = (await db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(ownerId)) as { id: string } | undefined;
  if (team) return team.id;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO teams (id, name, owner_id) VALUES (?, ?, ?)').run(id, 'T', ownerId);
  return id;
}

const inbound = (chatId: string, id: string, body: string) => ({
  type: 'message' as const,
  chatId,
  isGroup: chatId.endsWith('@g.us'),
  chatName: chatId.endsWith('@g.us') ? 'Grupo de prueba' : undefined,
  fromMe: false,
  senderPhone: '5490000000900',
  senderName: 'Persona de prueba',
  providerMessageId: id,
  body,
});

/** Una cuenta de Periskope en memoria con la forma de su API: rutas → respuesta. */
function account(routes: Record<string, unknown>): PeriskopeFetch & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    const u = new URL(path, 'https://x.test');
    const body = routes[u.pathname];
    if (body === undefined) throw new Error(`unexpected ${path}`);
    // Una sola página: con offset > 0 la lista viene vacía.
    if (Number(u.searchParams.get('offset') ?? 0) > 0 && body && typeof body === 'object' && !Array.isArray(body)) {
      return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? [] : v]));
    }
    return body;
  }) as PeriskopeFetch & { calls: string[] };
  get.calls = calls;
  return get;
}

describe('Periskope por API: lectura', () => {
  it('mapea tipos, valores, prioridades y estados', () => {
    expect(propertyTypeFrom('dropdown')).toBe('select');
    expect(propertyTypeFrom('picklist')).toBe('multiselect');
    expect(propertyTypeFrom('date')).toBe('date');
    expect(propertyTypeFrom('file')).toBe('text');
    expect(propertyCell(['A', { label: 'B' }])).toBe('A, B');
    expect(propertyCell(null)).toBe('');
    expect([0, 1, 2, 3, 4].map(ticketPriorityFrom)).toEqual(['low', 'low', 'medium', 'high', 'urgent']);
    expect(['open', 'inprogress', 'closed', 'archived', ''].map(ticketStatusFrom)).toEqual(['open', 'in_progress', 'closed', 'closed', 'open']);
  });

  it('manda la clave como Bearer y traduce los errores', async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    const ok = periskopeFetcher('k-123', (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') ?? '' });
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch);
    await ok('/phones/all');
    expect(seen).toEqual([{ url: 'https://api.periskope.app/v1/phones/all', auth: 'Bearer k-123' }]);
    const denied = periskopeFetcher('k', (async () => new Response('no', { status: 401 })) as unknown as typeof fetch);
    await expect(denied('/phones/all')).rejects.toThrow('periskope_auth');
    const limited = periskopeFetcher('k', (async () => new Response('no', { status: 429 })) as unknown as typeof fetch);
    await expect(limited('/phones/all')).rejects.toThrow('periskope_rate_limited');
    const down = periskopeFetcher('k', (async () => {
      throw new Error('net');
    }) as unknown as typeof fetch);
    await expect(down('/phones/all')).rejects.toThrow('periskope_unavailable');
  });
});

describe('Periskope por API: escribe', () => {
  it('chats, contactos, tickets y notas; la vista previa no escribe y repetir no duplica', async () => {
    const user = await makeUser('psk-api');
    const eva = await makeUser('psk-api-eva');
    await addMember(await teamOf(user.id), eva.id, 'member');
    const evaEmail = ((await getDb().prepare('SELECT email FROM users WHERE id = ?').get(eva.id)) as { email: string }).email;
    const a = await line(user.id, 'Ventas', '5490000000031');
    await ingestEvents(a, [inbound('120363000000888@g.us', 'PSKA-1', 'hola'), inbound('5490000000731@c.us', 'PSKA-2', 'hola')]);

    const get = account({
      '/phones/all': [{ org_phone: '5490000000031@c.us' }],
      '/properties': {
        success: true,
        data: [
          { property_id: 'property-plan', property_name: 'Plan', type: 'chat', kind: 'dropdown', options: [{ label: 'Pro' }, { label: 'Basic' }] },
          { property_id: 'property-renewal', property_name: 'Renewal', type: 'chat', kind: 'date' },
        ],
      },
      '/chats': {
        chats: [
          {
            chat_id: '120363000000888@g.us',
            chat_type: 'group',
            org_phone: '5490000000031@c.us',
            labels: ['VIP'],
            assigned_to: evaEmail,
            custom_properties: { 'property-plan': 'Pro', Renewal: '2026-03-01T00:00:00Z' },
          },
          { chat_id: '5490000000731@c.us', chat_type: 'user', labels: [], custom_properties: { 'property-plan': 'Enterprise' } },
          { chat_id: '120363999999999@g.us', chat_type: 'group', labels: ['X'] },
        ],
      },
      '/contacts': { contacts: [{ contact_id: '5490000000731@c.us', labels: ['Cliente'] }, { contact_id: '5490000000732@c.us', labels: [] }] },
      '/tickets': {
        tickets: [
          { ticket_id: 'T-1', chat_id: '120363000000888@g.us', subject: 'No anda', status: 'inprogress', priority: 4, assignee: evaEmail, created_at: '2026-01-02T10:00:00Z' },
          { ticket_id: 'T-2', chat_id: '5490000000731@c.us', subject: 'Listo', status: 'closed', priority: 1, assignee: 'nadie@ejemplo.test', created_at: '2026-01-03T10:00:00Z', closed_at: '2026-01-04T10:00:00Z' },
          { ticket_id: 'T-3', chat_id: '120363999999999@g.us', subject: 'Otro', status: 'open' },
          { ticket_id: 'T-4', chat_id: '120363000000888@g.us', subject: 'Borrado', is_deleted: true },
        ],
      },
      '/notes': {
        notes: [
          { message_id: 'true_n1_api', chat_id: '120363000000888@g.us', body: 'Nota interna', timestamp: '2026-01-02T11:00:00Z', performed_by: evaEmail },
          { message_id: 'true_n2_api', chat_id: '120363999999999@g.us', body: 'Sin chat' },
        ],
      },
    });

    const preview = await importPeriskopeApi(user.id, user.id, get, { dryRun: true });
    expect(preview).toMatchObject({ dryRun: true, phones: 1, properties: { found: 2, created: 2 }, truncated: false });
    expect(preview.tickets).toMatchObject({ found: 3, applied: 2 });
    expect(preview.notes).toMatchObject({ found: 2, applied: 1 });
    expect(preview.chats.ignoredColumns).toEqual([]);
    expect(await listPropertyDefs(user.id)).toHaveLength(0);
    expect((await listTickets(user.id, { status: 'all' })).length).toBe(0);
    expect((await listChats(user.id, user.id)).rows.every((c) => c.labels.length === 0)).toBe(true);
    // La clave va con cada pedido; las listas paginan con offset y limit.
    expect(get.calls).toContain('/chats?offset=0&limit=2000');

    const res = await importPeriskopeApi(user.id, user.id, get);
    expect(res.chats.applied).toBe(2);
    expect(res.chats.issues.map((i) => i.reason).sort()).toEqual(['chat_not_found', 'invalid_value:Plan']);
    expect(res.contacts.applied).toBe(1);
    expect(res.tickets).toMatchObject({ found: 3, applied: 2, existing: 0 });
    expect(res.tickets.issues.map((i) => i.reason).sort()).toEqual(['chat_not_found:T-3', 'unknown_assignee:T-2']);
    expect(res.notes).toMatchObject({ applied: 1 });

    const defs = await listPropertyDefs(user.id);
    expect(defs.map((d) => [d.label, d.type]).sort()).toEqual([['Plan', 'select'], ['Renewal', 'date']]);
    const rows = (await listChats(user.id, user.id)).rows;
    const g = rows.find((c) => c.kind === 'group')!;
    expect(g.labels.map((l) => l.name)).toEqual(['VIP']);
    expect(g.assignedTo).toBe(eva.id);
    const plan = defs.find((d) => d.label === 'Plan')!.key;
    const renewal = defs.find((d) => d.label === 'Renewal')!.key;
    expect(g.properties).toMatchObject({ [plan]: 'Pro', [renewal]: '2026-03-01' });
    const dm = rows.find((c) => c.kind === 'dm')!;
    expect(dm.labels.map((l) => l.name)).toEqual(['Cliente']);

    const tickets = await listTickets(user.id, { status: 'all' });
    const t1 = tickets.find((t) => t.title === 'No anda')!;
    expect(t1).toMatchObject({ status: 'in_progress', priority: 'urgent', assigneeId: eva.id, chatId: g.id, dueAt: null });
    expect(t1.createdAt.slice(0, 10)).toBe('2026-01-02');
    const t2 = tickets.find((t) => t.title === 'Listo')!;
    expect(t2).toMatchObject({ status: 'closed', priority: 'low', chatId: dm.id });

    const note = (await getDb().prepare("SELECT direction, body, author_id, created_at FROM groups_messages WHERE chat_id = ? AND direction = 'note'").all(g.id)) as Array<{
      body: string;
      author_id: string;
      created_at: string;
    }>;
    expect(note).toEqual([expect.objectContaining({ body: 'Nota interna', author_id: eva.id })]);
    expect(note[0].created_at.slice(0, 10)).toBe('2026-01-02');

    // Otra vez: nada nuevo.
    const again = await importPeriskopeApi(user.id, user.id, get);
    expect(again.tickets).toMatchObject({ applied: 0, existing: 2 });
    expect(again.notes).toMatchObject({ applied: 0, existing: 1 });
    expect(again.properties.created).toBe(0);
    expect((await listTickets(user.id, { status: 'all' })).length).toBe(2);
  });

  it('la cuenta simulada arma su respuesta con los chats del workspace y no ve otros', async () => {
    const owner = await makeUser('psk-api-fake');
    const other = await makeUser('psk-api-fake-b');
    const a = await line(owner.id, 'A', '5490000000041');
    await ingestEvents(a, [inbound('120363000000999@g.us', 'PSKF-1', 'hola'), inbound('5490000000741@c.us', 'PSKF-2', 'hola')]);
    await expect(importPeriskopeApi(owner.id, owner.id, fakePeriskope(owner.id, 'invalid-key'))).rejects.toThrow('periskope_auth');
    const res = await importPeriskopeApi(owner.id, owner.id, fakePeriskope(owner.id, 'psk-key'));
    expect(res.chats.applied).toBeGreaterThan(0);
    expect(res.tickets.applied).toBe(2);
    expect(res.notes.applied).toBe(1);
    const empty = await importPeriskopeApi(other.id, other.id, fakePeriskope(other.id, 'psk-key'));
    expect(empty.chats.rows + empty.tickets.found + empty.notes.found).toBe(0);
  });
});
