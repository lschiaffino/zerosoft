import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents } from '@/lib/groups';
import { systemViewer } from '@/lib/groups-access';
import { setLineAccess } from '@/lib/groups-lines';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectHubspot } from '@/lib/groups-hubspot';
import { resetFakeHubspot } from '@/lib/groups-hubspot-fake';
import { listLinesContacts } from '@/lib/groups-contacts';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';

/**
 * La celda de HubSpot de la tabla de Contactos de Lines: buscar contactos de
 * HubSpot por nombre para una persona (?hubspot=search) tiene los mismos
 * permisos que la ficha: hay que ver a la persona (por las líneas que uno ve),
 * los invitados no buscan, y otro workspace no la encuentra. Vincular desde la
 * celda es el mismo pedido que la ficha. Contra el HubSpot falso en memoria.
 */

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const personRoute = await import('@/app/api/groups/people/person/route');

const TOKEN = 'pat-na1-fake-token-for-table-cell';

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

async function line(ws: string, name: string) {
  const n = await createNumber(ws, ws, { provider: 'fake', name });
  await connectNumber(ws, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  return (await getNumberRowById(n.id))!;
}

async function dm(row: Awaited<ReturnType<typeof line>>, phone: string, name: string): Promise<string> {
  const chat = `${phone}@s.whatsapp.net`;
  await ingestEvents(row, [{ type: 'message', chatId: chat, isGroup: false, chatName: name, fromMe: false, senderPhone: phone, senderName: name, providerMessageId: `c-${randomUUID()}`, body: 'Hola' }]);
  const r = (await getDb().prepare('SELECT id FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(row.id, chat)) as { id: string };
  return r.id;
}

const search = (id: string, q: string) => personRoute.GET(new Request(`http://x/api/groups/people/person?id=${encodeURIComponent(id)}&hubspot=search&q=${encodeURIComponent(q)}`));
const post = (body: Record<string, unknown>) =>
  personRoute.POST(new Request('http://x/api/groups/people/person', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

describe('Contactos de Lines: buscar y vincular el contacto de HubSpot desde la celda', () => {
  it('busca por nombre para una persona que se ve; invitados, otro workspace y quien no ve la línea no', async () => {
    const w = await workspaceWithMember('hs-cell-search');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const open = await line(ws, 'Abierta');
    const reserved = await line(ws, 'Reservada');
    await setLineAccess(ws, reserved.id, { ownerId: ws, visibility: 'restricted', personIds: [], teamIds: [] });
    await dm(open, '5491155558101', 'Persona visible');
    await dm(reserved, '5491155558102', 'Persona reservada');
    const rows = (await listLinesContacts(systemViewer(ws))).rows;
    const seen = rows.find((r) => r.phone === '5491155558101')!;
    const hidden = rows.find((r) => r.phone === '5491155558102')!;
    expect(seen && hidden).toBeTruthy();

    // El owner busca: los contactos del HubSpot falso cuyo nombre, email o empresa tienen el texto.
    session.user = asOwner(w.owner) as unknown as Record<string, unknown>;
    const res = await search(seen.id, 'globex');
    expect(res.status).toBe(200);
    const found = (await res.json()) as { results: Array<{ id: string; type: string; url: string }> };
    expect(found.results.map((r) => r.id)).toEqual(['7002']);
    expect(found.results[0]).toMatchObject({ type: 'contact' });
    // Menos de 2 letras: nada (sin llamar a HubSpot).
    expect(((await (await search(seen.id, 'g')).json()) as { results: unknown[] }).results).toEqual([]);

    // Una persona del equipo ve la línea abierta, no la reservada.
    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    expect((await search(seen.id, 'globex')).status).toBe(200);
    expect((await search(hidden.id, 'globex')).status).toBe(404);
    // Tampoco vincula a quien no ve.
    expect((await post({ id: hidden.id, action: 'link', contactId: '7002' })).status).toBe(404);

    // Un invitado no busca ni vincula.
    session.user = asMember(w.owner, w.friend, 'guest') as unknown as Record<string, unknown>;
    expect((await search(seen.id, 'globex')).status).toBe(403);
    expect((await post({ id: seen.id, action: 'link', contactId: '7002' })).status).toBe(403);

    // Otro workspace no encuentra a la persona.
    session.user = asOwner(w.stranger) as unknown as Record<string, unknown>;
    expect((await search(seen.id, 'globex')).status).toBe(404);

    // Sin sesión, nada.
    session.user = null;
    expect((await search(seen.id, 'globex')).status).toBe(401);
  });

  it('vincular desde la celda deja el contacto y su empresa en la fila; desvincular lo quita', async () => {
    const w = await workspaceWithMember('hs-cell-link');
    const ws = w.owner.id;
    await connectHubspot(ws, ws, TOKEN);
    const open = await line(ws, 'Abierta');
    await dm(open, '5491155558201', 'Persona de prueba');
    const person = (await listLinesContacts(systemViewer(ws))).rows.find((r) => r.phone === '5491155558201')!;

    session.user = asMember(w.owner, w.member) as unknown as Record<string, unknown>;
    const linked = await post({ id: person.id, action: 'link', contactId: '7002' });
    expect(linked.status).toBe(200);
    const row = ((await linked.json()) as { row: { hubspot: { contact: { id: string } | null; company: { id: string } | null } } }).row;
    expect(row.hubspot.contact?.id).toBe('7002');
    expect(row.hubspot.company?.id).toBe('9002');
    const again = (await listLinesContacts(systemViewer(ws))).rows.find((r) => r.id === person.id)!;
    expect(again.hubspot?.contact?.id).toBe('7002');

    const unlinked = await post({ id: person.id, action: 'unlink' });
    expect(unlinked.status).toBe(200);
    expect((await listLinesContacts(systemViewer(ws))).rows.find((r) => r.id === person.id)!.hubspot?.contact).toBeNull();
  });
});
