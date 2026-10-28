import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { makeUser } from './helpers';

const now = () => new Date().toISOString();

describe('sacar a alguien pausa sus automatizaciones', () => {
  it('apaga webhooks (y cancela entregas), flows, robots y agentes con HTTP; avisa al owner', async () => {
    const owner = await makeUser('own');
    const admin = await makeUser('adm');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, admin.id, 'admin');
    const db = getDb();
    const id = () => crypto.randomUUID();
    const wh = id();
    const keepWh = id();
    await db.prepare("INSERT INTO webhooks (id, user_id, url, events, secret, created_by) VALUES (?, ?, 'https://evil.test', '[]', 's', ?)").run(wh, owner.id, admin.id);
    await db.prepare("INSERT INTO webhooks (id, user_id, url, events, secret, created_by) VALUES (?, ?, 'https://ok.test', '[]', 's', ?)").run(keepWh, owner.id, owner.id);
    const dl = id();
    await db.prepare("INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status) VALUES (?, ?, 'contact.created', '{}', 'pending')").run(dl, wh);
    const fl = id();
    await db
      .prepare("INSERT INTO flow_flows (id, user_id, name, enabled, graph, created_by, created_at, updated_at) VALUES (?, ?, 'f', 1, '{}', ?, ?, ?)")
      .run(fl, owner.id, admin.id, now(), now());
    const rb = id();
    await db
      .prepare("INSERT INTO robots (id, user_id, name, steps, enabled, created_by, created_at, updated_at) VALUES (?, ?, 'r', '[]', 1, ?, ?, ?)")
      .run(rb, owner.id, admin.id, now(), now());
    const agHttp = id();
    const agPlain = id();
    await db
      .prepare("INSERT INTO agents (id, user_id, name, tools, enabled, created_by, created_at, updated_at) VALUES (?, ?, 'a', '{\"http_request\":true}', 1, ?, ?, ?)")
      .run(agHttp, owner.id, admin.id, now(), now());
    await db
      .prepare("INSERT INTO agents (id, user_id, name, tools, enabled, created_by, created_at, updated_at) VALUES (?, ?, 'b', '{}', 1, ?, ?, ?)")
      .run(agPlain, owner.id, admin.id, now(), now());

    await removeMember(team.id, admin.id);

    const one = async (sql: string, ...args: string[]) => (await db.prepare(sql).get(...args)) as Record<string, unknown>;
    expect((await one('SELECT active FROM webhooks WHERE id = ?', wh)).active).toBe(0);
    expect((await one('SELECT active FROM webhooks WHERE id = ?', keepWh)).active).toBe(1);
    expect(await one('SELECT status, last_error FROM webhook_deliveries WHERE id = ?', dl)).toEqual({ status: 'failed', last_error: 'creator_removed' });
    expect((await one('SELECT enabled FROM flow_flows WHERE id = ?', fl)).enabled).toBe(0);
    expect((await one('SELECT enabled FROM robots WHERE id = ?', rb)).enabled).toBe(0);
    expect(await one('SELECT enabled, created_by FROM agents WHERE id = ?', agHttp)).toEqual({ enabled: 0, created_by: owner.id });
    expect(await one('SELECT enabled, created_by FROM agents WHERE id = ?', agPlain)).toEqual({ enabled: 1, created_by: owner.id });
    const note = await one("SELECT title, body FROM notifications WHERE user_id = ? AND source_type = 'workspace_member'", owner.id);
    expect(note.title).toBe('Automations paused');
    expect(String(note.body)).toContain('1 webhooks, 1 flows, 1 robots, 1 agents');
  });
});
