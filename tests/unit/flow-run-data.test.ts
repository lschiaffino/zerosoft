import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createFlow, getRunWithSteps, lastOutputs, listRuns } from '@/lib/flow';
import { makeUser } from './helpers';

/**
 * Los datos de una corrida (entrada del disparador, entrada y salida de cada
 * paso) pueden traer registros que un miembro no puede ver (visibilidad del
 * CRM): solo los ven quien creó el flow y los admins.
 */
describe('Flow: datos de las corridas', () => {
  it('quien no es admin ni creó el flow ve el estado sin los datos', async () => {
    const owner = await makeUser('frd');
    const f = await createFlow(owner.id, owner.id, { name: 'F' });
    if (!f.ok) throw new Error('flow');
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb()
      .prepare(
        `INSERT INTO flow_runs (id, flow_id, user_id, trigger_type, status, input, step_count, created_at, started_at, finished_at)
         VALUES (?, ?, ?, 'trigger.event', 'success', ?, 1, ?, ?, ?)`,
      )
      .run(runId, f.flow.id, owner.id, JSON.stringify({ contact: { email: 'secret@acme.com' } }), now, now, now);
    await getDb()
      .prepare(`INSERT INTO flow_steps (id, run_id, node_id, node_type, status, input, output, started_at, finished_at) VALUES (?, ?, 'trigger', 'trigger.manual', 'success', ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), runId, '{"a":"secret@acme.com"}', '{"b":"secret@acme.com"}', now, now);

    const member = { personId: 'someone-else', admin: false };
    const hidden = await getRunWithSteps(owner.id, runId, member);
    expect(hidden?.dataHidden).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain('secret@acme.com');
    expect(JSON.stringify(await listRuns(owner.id, f.flow.id, 30, member))).not.toContain('secret@acme.com');
    expect(await lastOutputs(owner.id, f.flow.id, member)).toEqual({});

    expect(JSON.stringify(await getRunWithSteps(owner.id, runId, { personId: owner.id, admin: false }))).toContain('secret@acme.com');
    expect(JSON.stringify(await getRunWithSteps(owner.id, runId, { personId: 'admin-x', admin: true }))).toContain('secret@acme.com');
  });
});
