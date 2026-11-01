import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import type { McpCaller } from '@/lib/mcp/caller';
import { getOperation, type Operation } from '@/lib/mcp/catalog';
import { invokeOperation, OperationError } from '@/lib/mcp/invoke';

process.env.NEXTAUTH_URL = 'https://zerosoft.test';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.MCP_OPERATION_TIMEOUT_MS = '150';

/** Handler que cambia en cada test, sin tocar las rutas reales. */
let handler: (req: Request) => Promise<Response> = async () => new Response('{}');
vi.mock('@/lib/mcp/route-table.generated', () => ({
  ROUTE_TABLE: new Proxy({}, { get: () => async () => ({ GET: (req: Request) => handler(req), POST: (req: Request) => handler(req) }) }),
}));

const outer = new Request('https://zerosoft.test/api/mcp');

async function caller(): Promise<McpCaller> {
  const id = `inv-${randomBytes(4).toString('hex')}`;
  await upsertUser({ id, email: `${id}@example.com`, name: id, image: null });
  return { kind: 'oauth', personId: id, teamId: null, canWrite: true, clientId: 'c', clientName: 'Test', grantId: `g-${id}`, apiKeyId: null, rateKey: `mcp:${id}` };
}

const op = (id: string) => getOperation(id) as Operation;

describe('plazo de una operación', () => {
  it('una escritura que no termina dice que el resultado es desconocido, y avisa al handler', async () => {
    let aborted = false;
    handler = (req) =>
      new Promise((_, reject) => {
        req.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    const err = await invokeOperation(outer, await caller(), op('crm.companies.create'), { body: { name: 'A' } }).catch((e) => e);
    expect(err).toBeInstanceOf(OperationError);
    expect(err.code).toBe('timeout');
    expect(err.message).toContain('outcome is unknown');
    expect(err.extra.outcome).toBe('unknown');
    expect(aborted).toBe(true);
  });

  it('leer un cuerpo que no termina también entra en el plazo', async () => {
    handler = async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
    const err = await invokeOperation(outer, await caller(), op('crm.contacts.list'), {}).catch((e) => e);
    expect(err.code).toBe('timeout');
  });
});

describe('salida', () => {
  it('JSON disfrazado de binario no vuelve', async () => {
    handler = async () => new Response(JSON.stringify({ access_token: 'abc123' }), { headers: { 'content-type': 'application/octet-stream' } });
    const r = await invokeOperation(outer, await caller(), op('crm.contacts.list'), {});
    expect(JSON.stringify(r.data)).not.toContain('abc123');
    expect((r.data as { base64?: string }).base64).toBeUndefined();
  });

  it('un PDF chico sí', async () => {
    handler = async () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } });
    const r = await invokeOperation(outer, await caller(), op('crm.contacts.list'), {});
    expect((r.data as { base64?: string }).base64).toBeTruthy();
  });

  it('el texto y el JSON roto pasan por el mismo filtro', async () => {
    handler = async () => new Response('email,token\nana@example.com,abc\n{"client_secret":"s3cret"}', { headers: { 'content-type': 'text/plain' } });
    const text = await invokeOperation(outer, await caller(), op('crm.contacts.list'), {});
    expect(String(text.data)).not.toContain('s3cret');
    handler = async () => new Response('{"client_secret":"s3cret","name":"cortado', { headers: { 'content-type': 'application/json' } });
    const cut = await invokeOperation(outer, await caller(), op('crm.contacts.list'), {});
    expect(String(cut.data)).not.toContain('s3cret');
  });

  it('un archivo sin valores secretos queda igual', async () => {
    handler = async () => new Response(JSON.stringify({ key: 'pub_abc', publishable_key: 'pub_abc' }), { headers: { 'content-type': 'application/json' } });
    const r = await invokeOperation(outer, await caller(), op('links.publishable_key.list'), {});
    expect(r.data).toEqual({ key: 'pub_abc', publishable_key: 'pub_abc' });
  });
});

describe('auditoría', () => {
  it('una exportación queda registrada, sin datos', async () => {
    const c = await caller();
    handler = async () => new Response('email\nana@example.com', { headers: { 'content-type': 'text/csv' } });
    await invokeOperation(outer, c, op('people.export.list'), {});
    const rows = (await getDb().prepare('SELECT * FROM mcp_audit_log WHERE user_id = ?').all(c.personId)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('people.export.list');
    expect(JSON.stringify(rows[0])).not.toContain('ana@example.com');
  });

  it('una lectura común no', async () => {
    const c = await caller();
    handler = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
    await invokeOperation(outer, c, op('crm.contacts.list'), {});
    expect((await getDb().prepare('SELECT * FROM mcp_audit_log WHERE user_id = ?').all(c.personId)).length).toBe(0);
  });
});
