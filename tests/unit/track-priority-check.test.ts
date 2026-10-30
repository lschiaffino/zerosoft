import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MIGRATIONS } from '@/lib/schema/migrations';

const migration = MIGRATIONS.find((m) => m.id === '146_track_priority_none_check')!;

describe('146_track_priority_none_check', () => {
  let client: Client;
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-priority-'));
    client = createClient({ url: `file:${path.join(dir, 'test.db')}` });
    await client.execute('PRAGMA foreign_keys = ON');
    await client.executeMultiple(`
      CREATE TABLE track_issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low'))
      );
      CREATE INDEX idx_track_issues_priority ON track_issues(priority);
      CREATE TABLE track_issue_log (issue_id TEXT);
      CREATE TRIGGER trg_track_issues_log AFTER INSERT ON track_issues BEGIN
        INSERT INTO track_issue_log (issue_id) VALUES (NEW.id);
      END;
      CREATE TABLE track_comments (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE
      );
      INSERT INTO track_issues (id, title, priority) VALUES ('a', 'old issue', 'high');
      INSERT INTO track_comments (id, issue_id) VALUES ('c', 'a');
    `);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts no priority and keeps rows, children, indexes and triggers', async () => {
    await expect(client.execute("INSERT INTO track_issues (id, title, priority) VALUES ('x', 't', 'none')")).rejects.toThrow(/CHECK/);

    await migration.up(client);

    await client.execute("INSERT INTO track_issues (id, title, priority) VALUES ('b', 'new', 'none')");
    await client.execute("INSERT INTO track_issues (id, title) VALUES ('d', 'default')");
    const rows = (await client.execute('SELECT id, priority FROM track_issues ORDER BY id')).rows.map((r) => [r.id, r.priority]);
    expect(rows).toEqual([['a', 'high'], ['b', 'none'], ['d', 'none']]);
    await expect(client.execute("INSERT INTO track_issues (id, title, priority) VALUES ('y', 't', 'nope')")).rejects.toThrow(/CHECK/);

    expect((await client.execute('SELECT id FROM track_comments')).rows.length).toBe(1);
    const names = (await client.execute("SELECT name FROM sqlite_master WHERE tbl_name = 'track_issues' AND type IN ('index', 'trigger')")).rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['idx_track_issues_priority', 'trg_track_issues_log']));
    expect((await client.execute('SELECT issue_id FROM track_issue_log')).rows.map((r) => r.issue_id)).toEqual(['a', 'b', 'd']);
    const fk = await client.execute("SELECT sql FROM sqlite_master WHERE name = 'track_comments'");
    expect(String(fk.rows[0].sql)).toContain('REFERENCES track_issues');
  });

  it('does nothing when the table already accepts it', async () => {
    await migration.up(client);
    const before = (await client.execute("SELECT sql FROM sqlite_master WHERE name = 'track_issues'")).rows[0].sql;
    await migration.up(client);
    expect((await client.execute("SELECT sql FROM sqlite_master WHERE name = 'track_issues'")).rows[0].sql).toBe(before);
    expect((await client.execute('SELECT id FROM track_issues')).rows.length).toBe(1);
  });
});
