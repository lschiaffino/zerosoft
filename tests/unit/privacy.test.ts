import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getClient, getDb } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { createSession, recordSecurityEvent } from '@/lib/account-security';
import { cancelErasure, eraseNow, exportAccountData, pendingErasure, requestErasure, runDueErasures, scopeWhere } from '@/lib/privacy';
import { seal } from '@/lib/secret-box';
import { addMember, createTeam } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { uploadsRoot } from '@/lib/uploads';
import { bufferSource, listZipEntries, readZipEntry } from '@/lib/zip-reader';
import { makeUser } from './helpers';

const db = () => getDb();

async function link(owner: string, url: string, title = 'x') {
  const id = `l-${crypto.randomUUID()}`;
  await db().prepare('INSERT INTO links (id, user_id, slug, url, title) VALUES (?, ?, ?, ?, ?)').run(id, owner, id.slice(0, 20), url, title);
  return id;
}

async function contact(ws: string, owner: string | null) {
  const id = `c-${crypto.randomUUID()}`;
  await db().prepare('INSERT INTO crm_contacts (id, user_id, owner_id, first_name, email) VALUES (?, ?, ?, ?, ?)').run(id, ws, owner, 'Ana', 'ana@example.com');
  return id;
}

/** Filas que todavía mencionan el id en una columna de dueño o workspace (lo que borrar tiene que dejar en 0). */
async function leftovers(id: string, teamId: string): Promise<string[]> {
  const out: string[] = [];
  const tables = (await getClient().execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).rows;
  for (const t of tables) {
    const name = String(t.name);
    // security_events se mira aparte: lo que hizo en workspaces ajenos queda en su registro.
    if (/^CREATE VIRTUAL/i.test(String(t.sql)) || name.includes('_fts') || name === 'privacy_erasures' || name === 'security_events') continue;
    const cols = (await getClient().execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: [name] })).rows.map((c) => String(c.name));
    for (const col of ['user_id', 'workspace_id', 'team_id']) {
      if (!cols.includes(col)) continue;
      // user_id en una fila de otro workspace (p. ej. el evento "salió del workspace" en el ajeno) no es suyo.
      const own = col === 'user_id' && cols.includes('workspace_id') ? ' AND (workspace_id IS NULL OR workspace_id IN (?, ?))' : '';
      const n = Number((await getClient().execute({ sql: `SELECT COUNT(*) AS n FROM "${name}" WHERE "${col}" IN (?, ?)${own}`, args: own ? [id, teamId, id, teamId] : [id, teamId] })).rows[0].n);
      if (n) out.push(`${name}.${col}=${n}`);
    }
  }
  return out;
}

describe('alcance del borrado', () => {
  const scope = { userId: 'u1', teamIds: ['ws_u1'], kind: 'account' as const };
  it('user_id es del workspace; owner_id del CRM (persona) no decide', () => {
    expect(scopeWhere('crm_contacts', ['id', 'user_id', 'owner_id'], scope)).toEqual({ sql: '(user_id = ?)', args: ['u1'] });
    expect(scopeWhere('inbox_accounts', ['id', 'owner_id'], scope)?.sql).toBe('((owner_id IN (?, ?)))');
    expect(scopeWhere('task_links', ['task_id', 'workspace_id', 'created_by'], scope)?.args).toEqual(['u1', 'ws_u1']);
    expect(scopeWhere('notes_versions', ['id', 'title'], scope)).toBeNull();
  });
  it('workspace_id manda sobre user_id: lo de un workspace ajeno no se toca', () => {
    expect(scopeWhere('x', ['user_id', 'workspace_id'], scope)?.sql).toBe('((workspace_id IN (?, ?))) OR (user_id = ? AND "workspace_id" IS NULL)');
  });
  it('borrar solo el workspace deja la cuenta', () => {
    const ws = { ...scope, kind: 'workspace' as const };
    expect(scopeWhere('users', ['id'], ws)).toBeNull();
    expect(scopeWhere('users', ['id'], scope)).toBeNull(); // la cuenta se anonimiza aparte
    expect(scopeWhere('user_sessions', ['id', 'user_id'], ws)).toBeNull();
    expect(scopeWhere('teams', ['id', 'owner_id'], ws)?.sql).toBe('owner_id = ?');
  });
});

describe('borrar la cuenta', () => {
  it('borra cuenta, workspace, hijas y archivos; deja lo de otros workspaces y a las otras personas', async () => {
    const a = await makeUser('era');
    const b = await makeUser('erb');
    const c = await makeUser('erc');
    const wsA = await ensureWorkspace(a.id);
    const teamC = await createTeam(c.id, 'C');
    await addMember(wsA.id, b.id, 'member');
    await addMember(teamC.id, a.id, 'member');

    // Datos del workspace de A, con un archivo subido y un secreto.
    const fileName = `erase-${crypto.randomUUID()}.png`;
    fs.mkdirSync(path.join(uploadsRoot(), 'docs'), { recursive: true });
    fs.writeFileSync(path.join(uploadsRoot(), 'docs', fileName), 'png');
    const linkA = await link(a.id, 'https://example.com', `/uploads/docs/${fileName}`);
    await db().prepare("INSERT INTO link_clicks (id, link_id, clicked_at) VALUES (?, ?, datetime('now'))").run(`k-${crypto.randomUUID()}`, linkA).catch(() => undefined);
    await contact(a.id, b.id);
    await createApiKey(a.id, 'k');
    await createSession(a.id, { method: 'google', ip: '1.1.1.1', userAgent: 'x' });
    await recordSecurityEvent({ userId: a.id, action: 'login', ip: null, userAgent: null });
    await db().prepare("INSERT INTO integrations (user_id, provider, access_token) VALUES (?, 'google', ?)").run(a.id, seal('ya29.secreto')).catch(() => undefined);

    // Datos de C: A es dueño de un contacto ahí y dejó un evento en su registro.
    const linkC = await link(c.id, 'https://c.example.com');
    const contactC = await contact(c.id, a.id);
    await recordSecurityEvent({ userId: a.id, teamId: teamC.id, action: 'api_key.create', ip: null, userAgent: null });

    // Export antes de borrar: zip con un JSON por tabla, sin secretos.
    const exp = await exportAccountData((await db().prepare('SELECT * FROM users WHERE id = ?').get(a.id)) as never);
    const entries = await listZipEntries(bufferSource(exp.zip));
    const names = entries.map((e) => e.name);
    expect(names).toContain('README.txt');
    expect(names).toContain('tables/links.json');
    expect(names).toContain('tables/crm_contacts.json');
    expect(names).not.toContain('tables/links_c.json');
    const keys = JSON.parse((await readZipEntry(bufferSource(exp.zip), entries.find((e) => e.name === 'tables/api_keys.json')!, 1e6)).toString('utf8')) as Array<Record<string, unknown>>;
    expect(keys[0].key_hash).toBe('[omitted]');
    for (const e of entries) {
      const text = (await readZipEntry(bufferSource(exp.zip), e, 5e6)).toString('utf8');
      expect(text).not.toMatch(/enc:v[12]:/);
      expect(text).not.toContain('ya29.secreto');
    }
    const linksJson = JSON.parse((await readZipEntry(bufferSource(exp.zip), entries.find((e) => e.name === 'tables/links.json')!, 1e6)).toString('utf8')) as Array<{ id: string }>;
    expect(linksJson.map((l) => l.id)).toEqual([linkA]);

    const stats = await eraseNow(a.id, 'account');
    expect(stats.rows).toBeGreaterThan(5);
    expect(stats.files).toBeGreaterThanOrEqual(1);

    expect(await leftovers(a.id, wsA.id)).toEqual([]);
    expect(await db().prepare('SELECT 1 FROM security_events WHERE user_id = ? AND (team_id IS NULL OR team_id = ?)').get(a.id, wsA.id)).toBeUndefined();
    const ghost = (await db().prepare('SELECT email, name FROM users WHERE id = ?').get(a.id)) as { email: string; name: string | null };
    expect(ghost.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(ghost.name).toBeNull();
    expect(fs.existsSync(path.join(uploadsRoot(), 'docs', fileName))).toBe(false);
    // B sigue existiendo, ya sin el workspace de A; A ya no es miembro de C.
    expect(await db().prepare('SELECT 1 FROM users WHERE id = ?').get(b.id)).toBeTruthy();
    expect(await db().prepare('SELECT 1 FROM team_members WHERE team_id = ?').get(wsA.id)).toBeUndefined();
    expect(await db().prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamC.id, a.id)).toBeUndefined();
    // Lo del workspace de C queda: su link, su contacto (aunque A fuera el dueño del registro) y su registro.
    expect(await db().prepare('SELECT 1 FROM links WHERE id = ?').get(linkC)).toBeTruthy();
    expect(await db().prepare('SELECT 1 FROM crm_contacts WHERE id = ?').get(contactC)).toBeTruthy();
    expect(await db().prepare("SELECT 1 FROM security_events WHERE team_id = ? AND action = 'api_key.create'").get(teamC.id)).toBeTruthy();
  });

  it('borrar solo el workspace deja la cuenta y sus sesiones', async () => {
    const a = await makeUser('wsd');
    const ws = await ensureWorkspace(a.id);
    await link(a.id, 'https://example.com');
    const sid = await createSession(a.id, { method: 'email', ip: null, userAgent: null });
    await eraseNow(a.id, 'workspace');
    expect(await db().prepare('SELECT 1 FROM links WHERE user_id = ?').get(a.id)).toBeUndefined();
    expect(await db().prepare('SELECT 1 FROM teams WHERE id = ?').get(ws.id)).toBeUndefined();
    expect(await db().prepare('SELECT 1 FROM users WHERE id = ?').get(a.id)).toBeTruthy();
    expect(await db().prepare('SELECT 1 FROM user_sessions WHERE id = ?').get(sid)).toBeTruthy();
  });
});

describe('lo de otros workspaces queda', () => {
  it('comentarios e ítems que la persona creó en un workspace ajeno, y archivos que otro sigue usando', async () => {
    await getClient().executeMultiple(`
      CREATE TABLE IF NOT EXISTS zz_boards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, cover TEXT);
      CREATE TABLE IF NOT EXISTS zz_comments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, board_id TEXT REFERENCES zz_boards(id) ON DELETE CASCADE, body TEXT);
      CREATE TABLE IF NOT EXISTS zz_items (id TEXT PRIMARY KEY, board_id TEXT REFERENCES zz_boards(id) ON DELETE CASCADE, creator_id TEXT REFERENCES users(id) ON DELETE CASCADE);
    `);
    const a = await makeUser('ova');
    const b = await makeUser('ovb');
    const c = await makeUser('ovc');
    const shared = `shared-${crypto.randomUUID()}.png`;
    fs.mkdirSync(path.join(uploadsRoot(), 'docs'), { recursive: true });
    fs.writeFileSync(path.join(uploadsRoot(), 'docs', shared), 'png');
    const ins = (sql: string, ...args: string[]) => db().prepare(sql).run(...args);
    await ins('INSERT INTO zz_boards (id, user_id, cover) VALUES (?, ?, ?)', 'bA', a.id, `/uploads/docs/${shared}`);
    await ins('INSERT INTO zz_boards (id, user_id, cover) VALUES (?, ?, ?)', 'bC', c.id, `/uploads/docs/${shared}`);
    await ins('INSERT INTO zz_comments (id, user_id, board_id, body) VALUES (?, ?, ?, ?)', 'cB-on-A', b.id, 'bA', 'hola');
    await ins('INSERT INTO zz_comments (id, user_id, board_id, body) VALUES (?, ?, ?, ?)', 'cA-on-C', a.id, 'bC', 'hola');
    await ins('INSERT INTO zz_items (id, board_id, creator_id) VALUES (?, ?, ?)', 'iA-on-C', 'bC', a.id);
    await ins('INSERT INTO zz_items (id, board_id, creator_id) VALUES (?, ?, ?)', 'iA-on-A', 'bA', a.id);

    await eraseNow(a.id, 'workspace');
    const ids = async (t: string) => ((await db().prepare(`SELECT id FROM ${t} ORDER BY id`).all()) as Array<{ id: string }>).map((r) => r.id);
    expect(await ids('zz_boards')).toEqual(['bC']);
    // En su workspace se va todo (también lo que escribió otro); en el ajeno queda lo que hizo.
    expect(await ids('zz_comments')).toEqual(['cA-on-C']);
    expect(await ids('zz_items')).toEqual(['iA-on-C']);
    // El archivo que C sigue usando no se borra.
    expect(fs.existsSync(path.join(uploadsRoot(), 'docs', shared))).toBe(true);

    await eraseNow(a.id, 'account');
    expect(await ids('zz_comments')).toEqual(['cA-on-C']);
    expect(await ids('zz_items')).toEqual(['iA-on-C']);
  });
});

describe('owner_id de persona en tablas con workspace', () => {
  it('lo que la persona creó en un workspace ajeno (Send, Notes) queda en ese workspace', async () => {
    const a = await makeUser('owa');
    const b = await makeUser('owb');
    await ensureWorkspace(a.id);
    const wsB = await ensureWorkspace(b.id);
    await addMember(wsB.id, a.id, 'member');
    const ts = new Date().toISOString();
    const ins = (sql: string, ...args: Array<string | null>) => db().prepare(sql).run(...args);
    // En el workspace de B (workspace_id = B), creados por A (owner_id = A).
    await ins("INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, 'doc', 'private', ?, ?)", 'sdA-on-B', b.id, a.id, ts, ts);
    await ins("INSERT INTO note_shares (id, workspace_id, owner_id, note_id, notebook_id, person_id, role, created_at) VALUES (?, ?, ?, NULL, NULL, ?, 'view', ?)", 'nsA-on-B', b.id, a.id, b.id, ts);
    // En el de A: se van.
    await ins("INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, 'doc', 'private', ?, ?)", 'sdA-on-A', a.id, a.id, ts, ts);

    await eraseNow(a.id, 'workspace');
    expect(await db().prepare('SELECT 1 FROM send_documents WHERE id = ?').get('sdA-on-A')).toBeUndefined();
    expect(await db().prepare('SELECT 1 FROM send_documents WHERE id = ?').get('sdA-on-B')).toBeTruthy();
    expect(await db().prepare('SELECT 1 FROM note_shares WHERE id = ?').get('nsA-on-B')).toBeTruthy();
    await eraseNow(a.id, 'account');
    expect(await db().prepare('SELECT 1 FROM send_documents WHERE id = ?').get('sdA-on-B')).toBeTruthy();
    expect(await db().prepare('SELECT 1 FROM note_shares WHERE id = ?').get('nsA-on-B')).toBeTruthy();
  });
});

describe('pedidos de borrado', () => {
  it('30 días para arrepentirse, se cancela, y el cron lo ejecuta una sola vez', async () => {
    const a = await makeUser('req');
    await ensureWorkspace(a.id);
    const now = Date.now();
    const row = await requestErasure(a.id, 'workspace', a.id, now);
    expect(Date.parse(row.due_at) - now).toBe(30 * 86_400_000);
    // Pedir la cuenta después amplía el pedido y mantiene la fecha.
    const acc = await requestErasure(a.id, 'account', a.id, now + 1000);
    expect(acc.kind).toBe('account');
    expect(acc.due_at).toBe(row.due_at);
    expect(await cancelErasure(a.id)).toBeTruthy();
    expect(await pendingErasure(a.id)).toBeNull();

    await requestErasure(a.id, 'account', a.id, now);
    expect(await runDueErasures(now + 29 * 86_400_000)).toBe(0);
    const later = now + 31 * 86_400_000;
    const [first, second] = await Promise.all([runDueErasures(later), runDueErasures(later)]);
    expect(first + second).toBe(1);
    expect(((await db().prepare('SELECT email FROM users WHERE id = ?').get(a.id)) as { email: string }).email).toMatch(/@deleted\.invalid$/);
    expect(await db().prepare("SELECT 1 FROM security_events WHERE action = 'account.deleted' AND meta LIKE ?").get(`%${(await db().prepare('SELECT id FROM privacy_erasures WHERE user_id = ? AND done_at IS NOT NULL').get(a.id) as { id: string }).id}%`)).toBeTruthy();
  });
});
