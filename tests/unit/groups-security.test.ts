import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, deleteNumber, getNumberRowById, ingestEvents, readConfig, INBOUND_MEDIA_PER_WEBHOOK } from '@/lib/groups';
import { bridgeRequest, evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { retryManagedDeletes } from '@/lib/groups-provider-managed';
import { ProviderError, type FetchLike } from '@/lib/groups-provider';
import { makeUser } from './helpers';

/** Sesión que usan las rutas (getCurrentUser), para probar como member. */
const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string; role: string } }));
vi.mock('@/lib/session', async (orig) => ({ ...((await orig()) as object), getCurrentUser: async () => session.user }));

const connectRoute = await import('@/lib/routes/groups/numbers/[id]/connect/route');

const BRIDGE = 'https://bridge.example.test';

/** Respuesta en streaming sin content-length (no se puede saber el largo antes de leer). */
function streamed(bytes: number, chunk = 64 * 1024): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(65));
    },
  });
  return new Response(body, { status: 200 });
}

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'zs-groups-sec-')));
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('VERCEL', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  session.user = null;
});

describe('tope de bytes al leer del gateway', () => {
  it('corta mientras lee aunque no haya content-length', async () => {
    const f: FetchLike = async () => streamed(2 * 1024 * 1024);
    await expect(bridgeRequest(f, `${BRIDGE}/x`, {}, 'GET', undefined, { maxBytes: 1024 * 1024 })).rejects.toMatchObject({ httpStatus: 413 });
    const declared: FetchLike = async () => new Response('{}', { headers: { 'content-length': String(50 * 1024 * 1024) } });
    await expect(bridgeRequest(declared, `${BRIDGE}/x`, {}, 'GET', undefined, { maxBytes: 1024 })).rejects.toMatchObject({ httpStatus: 413 });
    const ok: FetchLike = async () => new Response(JSON.stringify({ a: 1 }));
    expect(await bridgeRequest(ok, `${BRIDGE}/x`, {}, 'GET')).toEqual({ a: 1 });
  });

  it('un archivo más grande que el tope no se decodifica, diga lo que diga el mensaje', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024).toString('base64');
    const f: FetchLike = async () => new Response(JSON.stringify({ base64: big, mimetype: 'image/jpeg' }));
    const p = evolutionProvider({ baseUrl: BRIDGE, apiKey: 'k', session: 's' }, { fetch: f });
    await expect(p.fetchMedia!({ providerMessageId: 'X', chatId: '1@s.whatsapp.net', fromMe: false }, 1024 * 1024)).rejects.toBeInstanceOf(ProviderError);
  });

  it('de un webhook se bajan los archivos de a uno, hasta el tope de cantidad', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify({ base64: Buffer.from('hola').toString('base64'), mimetype: 'text/plain', fileName: 'a.txt' }));
    });
    const user = await makeUser('sec-batch');
    const n = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: BRIDGE, apiKey: 'k', session: 's' } });
    const row = (await getNumberRowById(n.id))!;
    const data = Array.from({ length: INBOUND_MEDIA_PER_WEBHOOK + 3 }, (_, i) => ({
      key: { remoteJid: '5491155550000@s.whatsapp.net', fromMe: false, id: `DOC${i}` },
      message: { documentMessage: { mimetype: 'text/plain', fileName: `a${i}.txt`, fileLength: 4 } },
    }));
    await ingestEvents(row, parseEvolutionWebhook({ event: 'messages.upsert', data }));
    expect(calls).toBe(INBOUND_MEDIA_PER_WEBHOOK);
    expect(maxInFlight).toBe(1);
    const pending = (await getDb().prepare("SELECT COUNT(*) AS c FROM groups_messages WHERE number_id = ? AND media_url LIKE 'evo:%'").get(row.id)) as { c: number };
    expect(Number(pending.c)).toBe(3);
  });
});

describe('fallas definitivas de un archivo', () => {
  it('un tipo no permitido o que el gateway no tiene queda sin archivo y no se vuelve a pedir', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
      calls++;
      const id = JSON.parse(String(init.body)).message.key.id;
      if (id === 'GONE') return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ base64: Buffer.from('MZ').toString('base64'), mimetype: 'application/x-msdownload', fileName: 'setup.exe' }));
    });
    const user = await makeUser('sec-fail');
    const n = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: BRIDGE, apiKey: 'k', session: 's' } });
    const row = (await getNumberRowById(n.id))!;
    const msg = (id: string) => ({
      key: { remoteJid: '5491155550000@s.whatsapp.net', fromMe: false, id },
      message: { documentMessage: { mimetype: 'application/octet-stream', fileName: 'archivo', fileLength: 2 } },
    });
    await ingestEvents(row, parseEvolutionWebhook({ event: 'messages.upsert', data: [msg('EXE'), msg('GONE')] }));
    const rows = (await getDb().prepare('SELECT provider_message_id AS id, media_url, media_type, media_name FROM groups_messages WHERE number_id = ? ORDER BY provider_message_id').all(row.id)) as Array<{
      id: string;
      media_url: string;
      media_type: string;
      media_name: string;
    }>;
    expect(rows).toEqual([
      { id: 'EXE', media_url: '', media_type: 'application/octet-stream', media_name: 'archivo' },
      { id: 'GONE', media_url: '', media_type: 'application/octet-stream', media_name: 'archivo' },
    ]);
    expect(calls).toBe(2);
  });
});

describe('borrar un número administrado', () => {
  it('sin la config del servidor no se borra; si el borrado de la instancia falla, el cron lo reintenta una sola vez por claim', async () => {
    vi.stubEnv('GROUPS_BRIDGE_URL', BRIDGE);
    vi.stubEnv('GROUPS_BRIDGE_KEY', 'global');
    const user = await makeUser('sec-tomb');
    const n = await createNumber(user.id, user.id, { provider: 'managed' });
    const instance = String(readConfig((await getNumberRowById(n.id))!).session);

    vi.stubEnv('GROUPS_BRIDGE_URL', '');
    await expect(deleteNumber(user.id, n.id)).rejects.toMatchObject({ code: 'bridge_unavailable' });
    expect(await getNumberRowById(n.id)).not.toBeNull();

    vi.stubEnv('GROUPS_BRIDGE_URL', BRIDGE);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    expect(await deleteNumber(user.id, n.id)).toBe(true);
    expect(await getNumberRowById(n.id)).toBeNull();
    const tomb = () => getDb().prepare('SELECT instance, attempts FROM groups_bridge_tombstones WHERE instance = ?').get(instance) as Promise<{ attempts: number } | undefined>;
    expect(await tomb()).toMatchObject({ attempts: 0 });

    // Dos corridas a la vez: solo una reclama la fila.
    const deletes: string[] = [];
    const f: FetchLike = async (url, init) => {
      if (init?.method === 'DELETE' && url.includes('/instance/delete/')) deletes.push(url);
      return new Response('{}');
    };
    const [a, b] = await Promise.all([retryManagedDeletes({ fetch: f }), retryManagedDeletes({ fetch: f })]);
    expect(a.deleted + b.deleted).toBe(1);
    expect(deletes.filter((u) => u.endsWith(`/instance/delete/${instance}`))).toHaveLength(1);
    expect(await tomb()).toBeUndefined();
  });
});

describe('estado de la conexión para quien no es admin', () => {
  it('no ve el QR ni hace que se consulte al proveedor', async () => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('NODE_ENV', 'test');
    const owner = await makeUser('sec-owner');
    const n = await createNumber(owner.id, owner.id, { provider: 'fake' });
    const net = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', net);
    const before = (await getNumberRowById(n.id))!.updated_at;
    session.user = { id: owner.id, email: owner.email, name: 'm', role: 'member' };
    const res = await connectRoute.GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: n.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'pending' });
    expect(body.qr).toBeUndefined();
    expect((await getNumberRowById(n.id))!.updated_at).toBe(before);
    expect(net).not.toHaveBeenCalled();
  });
});
