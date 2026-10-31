import { describe, expect, it } from 'vitest';
import { createAgent, duplicateAgent, getAgentRow, updateAgent } from '@/lib/agents';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

describe('duplicar agente', () => {
  it('copia la configuración y deja afuera canales, secretos y conversaciones', async () => {
    const u = await makeUser();
    const a = await createAgent(u.id, u.id, { name: 'Soporte', instructions: 'Respondé corto.' });
    await updateAgent(u.id, a.id, { publicHandle: 'soporte-dup' }, u.id);
    await getDb().prepare("UPDATE agents SET http_secrets = '[{\"name\":\"x\"}]', mcp_servers = '[{\"url\":\"u\"}]' WHERE id = ?").run(a.id);

    const copy = await duplicateAgent(u.id, a.id, u.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(a.id);
    expect(copy!.name).toBe('Soporte (copy)');
    expect(copy!.instructions).toBe('Respondé corto.');
    expect(copy!.publicHandle).toBeNull();
    const row = await getAgentRow(u.id, copy!.id);
    expect(row!.http_secrets).toBe('[]');
    expect(row!.mcp_servers).toBe('[]');
    // El original queda igual.
    expect((await getAgentRow(u.id, a.id))!.public_handle).toBe('soporte-dup');
  });

  it('usa el nombre pedido y no copia agentes de otro workspace', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const a = await createAgent(u.id, u.id, { name: 'Ventas' });
    expect((await duplicateAgent(u.id, a.id, u.id, '  Ventas v2 '))!.name).toBe('Ventas v2');
    expect(await duplicateAgent(other.id, a.id, other.id)).toBeNull();
  });
});
