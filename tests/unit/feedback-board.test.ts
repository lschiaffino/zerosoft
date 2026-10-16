import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { getDb } from '@/lib/db';
import type { ChangelogEntryRow, RoadmapItemRow } from '@/lib/db';
import { MIGRATIONS, runMigrations } from '@/lib/schema/migrations';
import { getRoadmapItem, updateRoadmapItem } from '@/lib/roadmap';
import {
  addComment,
  createIdea,
  deleteComment,
  findSimilarItems,
  listBoardItems,
  listComments,
  moderateComment,
  renderCommentHtml,
  toggleVote,
} from '@/lib/board';
import { notifyStatusChange, unsubscribeToken, verifyUnsubscribeToken } from '@/lib/board-notify';
import {
  createChangelogEntry,
  getUnifiedChangelog,
  mergeChangelog,
  renderChangelogMarkdown,
} from '@/lib/changelog';
import type { ChangelogEntry } from '@/content/changelog';
import { surfaceForHost, surfaceRewritePath } from '@/lib/host-rewrite';
import { isAppHost, isTrustedReturnUrl, safeCallbackUrl } from '@/lib/hosts';
import { sessionCookieDomain } from '@/lib/auth';
import { idFromRef, itemRef, slugifyTitle } from '@/lib/roadmap-constants';
import { boardItemPath, boardPath } from '@/lib/board-paths';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const { POST: createItemRoute } = await import('@/app/api/board/items/route');
const { POST: voteRoute } = await import('@/app/api/board/items/[id]/vote/route');
const { POST: commentRoute } = await import('@/app/api/board/items/[id]/comments/route');
const { DELETE: deleteCommentRoute, PATCH: patchCommentRoute } = await import('@/app/api/board/comments/[id]/route');
const { POST: promoteRoute } = await import('@/app/api/feedback/[id]/promote/route');
const { POST: changelogRoute } = await import('@/app/api/changelog-entries/route');

const ENV_KEYS = ['ADMIN_EMAILS', 'RESEND_API_KEY', 'FEEDBACK_HOST', 'BRANDING_HOST', 'NEXTAUTH_URL', 'SESSION_COOKIE_DOMAIN', 'APP_HOSTS', 'RATE_LIMIT_DISABLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RATE_LIMIT_DISABLED = 'true';
  session.user = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function makeItem(overrides: Partial<RoadmapItemRow> = {}): Promise<RoadmapItemRow> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO roadmap_items (id, title, description, product, kind, status, votes, is_public, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'idea', ?, 0, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.title ?? `Item ${id.slice(0, 6)}`,
      overrides.description ?? '',
      overrides.product ?? 'crm',
      overrides.status ?? 'idea',
      overrides.is_public ?? 1,
      now,
      now,
    );
  return (await getRoadmapItem(id))!;
}

function req(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.77.0.1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

// ---------------------------------------------------------------------------

describe('board: estados y migración 034', () => {
  function freshClient() {
    return createClient({ url: `file:${path.join(os.tmpdir(), `mig-board-${crypto.randomUUID()}.db`)}` });
  }

  it('reconstruye el CHECK de status sin perder ítems, señales ni votos por IP', async () => {
    const client = freshClient();
    const idx = MIGRATIONS.findIndex((m) => m.id === '034_feedback_board');
    expect(idx).toBeGreaterThan(0);
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    const now = new Date().toISOString();
    await client.execute(
      `INSERT INTO roadmap_items (id, title, product, kind, status, votes, is_public, created_at, updated_at)
       VALUES ('a', 'Triage', 'crm', 'idea', 'proposed', 7, 0, '${now}', '${now}'),
              ('b', 'Planned', 'cal', 'idea', 'planned', 99, 1, '${now}', '${now}')`,
    );
    await client.execute(
      `INSERT INTO roadmap_signals (id, item_id, source, source_id, excerpt, created_at) VALUES ('s1', 'b', 'feedback', 'f1', 'x', '${now}')`,
    );
    await client.execute(`INSERT INTO roadmap_votes (item_id, ip_hash, created_at) VALUES ('b', 'h1', '${now}')`);
    await expect(
      client.execute(`INSERT INTO roadmap_items (id, title, status, created_at, updated_at) VALUES ('c', 'x', 'considering', '${now}', '${now}')`),
    ).rejects.toThrow(/CHECK/);
    await client.execute('PRAGMA foreign_keys = ON');

    await runMigrations(client);

    const rows = (await client.execute("SELECT id, status, votes, is_public FROM roadmap_items WHERE id IN ('a', 'b') ORDER BY id")).rows;
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 'a', status: 'proposed', votes: 0, is_public: 0 },
      // 1 señal + 1 voto por IP (legado): recalculado con COUNT.
      { id: 'b', status: 'planned', votes: 2, is_public: 1 },
    ]);
    expect((await client.execute("SELECT COUNT(*) AS n FROM roadmap_signals WHERE item_id = 'b'")).rows[0].n).toBe(1);
    const votes = (await client.execute("SELECT user_id, ip_hash FROM roadmap_votes WHERE item_id = 'b'")).rows;
    expect(votes.map((r) => ({ ...r }))).toEqual([{ user_id: null, ip_hash: 'h1' }]);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);

    for (const status of ['idea', 'considering']) {
      await client.execute(
        `INSERT INTO roadmap_items (id, title, status, created_at, updated_at) VALUES ('${status}', 'x', '${status}', '${now}', '${now}')`,
      );
    }
    await expect(
      client.execute(`INSERT INTO roadmap_items (id, title, status, created_at, updated_at) VALUES ('z', 'x', 'bogus', '${now}', '${now}')`),
    ).rejects.toThrow(/CHECK/);
    const indexes = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'roadmap_items'")).rows.map(
      (r) => r.name,
    );
    expect(indexes).toEqual(expect.arrayContaining(['idx_roadmap_items_status', 'idx_roadmap_items_public']));
    const cols = (await client.execute('PRAGMA table_info(roadmap_items)')).rows.map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['author_id', 'declined_reason', 'comment_count', 'status_changed_at']));
  });

  it('proposed es triage privado: nunca aparece en el board', async () => {
    const triage = await makeItem({ status: 'proposed', is_public: 1 });
    const idea = await makeItem({ status: 'idea' });
    const closed = await makeItem({ status: 'declined' });
    const hidden = await makeItem({ status: 'planned', is_public: 0 });
    const ids = (await listBoardItems({ limit: 500 })).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([idea.id, closed.id]));
    expect(ids).not.toContain(triage.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('cambiar de estado registra el evento y guarda el motivo de cierre', async () => {
    const item = await makeItem({ status: 'idea' });
    await updateRoadmapItem(item.id, { status: 'declined', declinedReason: 'Fuera de alcance' });
    const events = (await getDb()
      .prepare('SELECT from_status, to_status, note FROM roadmap_status_events WHERE item_id = ?')
      .all(item.id)) as Array<{ from_status: string; to_status: string; note: string }>;
    expect(events).toEqual([{ from_status: 'idea', to_status: 'declined', note: 'Fuera de alcance' }]);
    const after = (await getRoadmapItem(item.id))!;
    expect(after.declined_reason).toBe('Fuera de alcance');
    expect(after.status_changed_at).toBeTruthy();
  });

  it('refs de URL: <id>-<slug> para UUIDs e ids sin guiones', () => {
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(itemRef(uuid, 'Exportar contactos a CSV')).toBe(`${uuid}-exportar-contactos-a-csv`);
    expect(idFromRef(`${uuid}-exportar-contactos-a-csv`)).toBe(uuid);
    expect(idFromRef('rm_seed_flow-flow-visual-automations')).toBe('rm_seed_flow');
    expect(slugifyTitle('¡Integración con Señales!')).toBe('integracion-con-senales');
    expect(boardPath('es', true, '/i/x')).toBe('/es/i/x');
    expect(boardItemPath('es', false, 'abc', 'Hola')).toBe('/es/feedback-board/i/abc-hola');
  });
});

// ---------------------------------------------------------------------------

describe('board: votos por usuario', () => {
  it('toggle: votar y quitar, un voto por usuario, COUNT con votos IP de legado', async () => {
    const item = await makeItem({ status: 'considering' });
    await getDb()
      .prepare("INSERT INTO roadmap_votes (id, item_id, ip_hash, created_at) VALUES (?, ?, 'legacy-ip', ?)")
      .run(crypto.randomUUID(), item.id, new Date().toISOString());
    const a = await makeUser('bv-a');
    const b = await makeUser('bv-b');
    expect(await toggleVote(item.id, a.id)).toEqual({ ok: true, voted: true, votes: 2 });
    expect(await toggleVote(item.id, b.id)).toEqual({ ok: true, voted: true, votes: 3 });
    expect(await toggleVote(item.id, a.id)).toEqual({ ok: true, voted: false, votes: 2 });
    // force: idempotente
    expect(await toggleVote(item.id, b.id, { force: 'on' })).toEqual({ ok: true, voted: true, votes: 2 });
    expect((await getRoadmapItem(item.id))!.votes).toBe(2);
  });

  it('UNIQUE(item, user) en la base', async () => {
    const item = await makeItem();
    const u = await makeUser('bv-u');
    const now = new Date().toISOString();
    const db = getDb();
    await db.prepare('INSERT INTO roadmap_votes (id, item_id, user_id, created_at) VALUES (?, ?, ?, ?)').run('v1', item.id, u.id, now);
    await expect(
      db.prepare('INSERT INTO roadmap_votes (id, item_id, user_id, created_at) VALUES (?, ?, ?, ?)').run('v2', item.id, u.id, now),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('la API exige sesión, suscribe al votante y rechaza ítems cerrados', async () => {
    const item = await makeItem({ status: 'planned' });
    expect((await voteRoute(req('http://x/v', 'POST'), params(item.id))).status).toBe(401);
    const u = await makeUser('bv-api');
    session.user = u;
    const res = await voteRoute(req('http://x/v', 'POST', { locale: 'es' }), params(item.id));
    expect(await res.json()).toEqual({ voted: true, votes: 1 });
    const sub = (await getDb()
      .prepare('SELECT reason, active, locale FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?')
      .get(item.id, u.id)) as { reason: string; active: number; locale: string };
    expect(sub).toEqual({ reason: 'vote', active: 1, locale: 'es' });
    const done = await makeItem({ status: 'done' });
    expect((await voteRoute(req('http://x/v', 'POST'), params(done.id))).status).toBe(409);
    const triage = await makeItem({ status: 'proposed', is_public: 0 });
    expect((await voteRoute(req('http://x/v', 'POST'), params(triage.id))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('board: ideas nuevas', () => {
  it('requiere sesión, respeta el honeypot y publica en idea con el voto del autor', async () => {
    const body = { title: 'Kanban de deals con WIP limits', description: 'Para ventas', product: 'crm' };
    expect((await createItemRoute(req('http://x/i', 'POST', body))).status).toBe(401);
    const u = await makeUser('bi-author');
    session.user = u;
    const spam = await createItemRoute(req('http://x/i', 'POST', { ...body, website: 'http://spam' }));
    expect(spam.status).toBe(200);
    expect(await spam.json()).toEqual({ ok: true });
    expect((await createItemRoute(req('http://x/i', 'POST', { title: 'x' }))).status).toBe(400);
    const res = await createItemRoute(req('http://x/i', 'POST', body));
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: RoadmapItemRow & { ref: string } };
    expect(item).toMatchObject({ status: 'idea', is_public: 1, author_id: u.id, votes: 1, product: 'crm' });
    expect(item.ref).toBe(itemRef(item.id, item.title));
    const similar = await findSimilarItems('wip limits en el kanban', u.id);
    expect(similar[0]).toMatchObject({ id: item.id, voted: true });
  });

  it('ordena por top, nuevos y tendencia', async () => {
    const product = 'robots';
    const old = await makeItem({ title: 'Viejo con votos', product });
    const fresh = await makeItem({ title: 'Nuevo', product });
    const users = await Promise.all([makeUser('s1'), makeUser('s2')]);
    for (const u of users) await toggleVote(old.id, u.id);
    // Votos viejos: no cuentan para tendencia.
    await getDb().prepare("UPDATE roadmap_votes SET created_at = '2020-01-01T00:00:00.000Z' WHERE item_id = ?").run(old.id);
    await getDb().prepare("UPDATE roadmap_items SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
    await toggleVote(fresh.id, users[0].id);
    const ids = async (sort: 'top' | 'new' | 'trending') => (await listBoardItems({ product, sort })).map((i) => i.id);
    expect((await ids('top'))[0]).toBe(old.id);
    expect((await ids('new'))[0]).toBe(fresh.id);
    expect((await ids('trending'))[0]).toBe(fresh.id);
    expect((await listBoardItems({ product, q: 'viejo' })).map((i) => i.id)).toEqual([old.id]);
  });
});

// ---------------------------------------------------------------------------

describe('board: comentarios', () => {
  it('sanitiza el markdown: sin scripts, links con rel nofollow', () => {
    const html = renderCommentHtml('Hola **mundo** <script>alert(1)</script> [x](javascript:alert(1)) https://zerosoft.ai');
    expect(html).toContain('<strong>mundo</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(renderCommentHtml('[ok](https://zerosoft.ai)')).toContain('rel="nofollow ugc noopener noreferrer"');
  });

  it('crear, borrar propio; ajeno solo admin; fijar y respuesta oficial solo admin', async () => {
    process.env.ADMIN_EMAILS = 'boss-board@test.local';
    const item = await makeItem({ status: 'planned' });
    const alice = await makeUser('bc-alice');
    const bob = await makeUser('bc-bob');
    const boss = { ...(await makeUser('bc-boss')), email: 'boss-board@test.local' };
    await getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run(boss.email, boss.id);

    expect((await commentRoute(req('http://x/c', 'POST', { body: 'hola' }), params(item.id))).status).toBe(401);
    session.user = alice;
    const created = await commentRoute(req('http://x/c', 'POST', { body: 'Lo necesito para ventas' }), params(item.id));
    expect(created.status).toBe(201);
    const { comment } = (await created.json()) as { comment: { id: string; is_official: number } };
    expect(comment.is_official).toBe(0);
    // Oficial sin ser admin: 403.
    expect((await commentRoute(req('http://x/c', 'POST', { body: 'oficial', official: true }), params(item.id))).status).toBe(403);
    expect((await getRoadmapItem(item.id))!.comment_count).toBe(1);

    session.user = bob;
    expect((await deleteCommentRoute(req('http://x/d', 'DELETE'), params(comment.id))).status).toBe(403);
    expect((await patchCommentRoute(req('http://x/p', 'PATCH', { pinned: true }), params(comment.id))).status).toBe(403);

    session.user = boss;
    const official = await commentRoute(req('http://x/c', 'POST', { body: 'Está planeado para Q1', official: true }), params(item.id));
    const { comment: answer } = (await official.json()) as { comment: { id: string; is_official: number } };
    expect(answer.is_official).toBe(1);
    expect((await patchCommentRoute(req('http://x/p', 'PATCH', { pinned: true }), params(answer.id))).status).toBe(200);
    const list = await listComments(item.id);
    expect(list[0]).toMatchObject({ id: answer.id, pinned: 1, is_official: 1 });

    session.user = alice;
    expect((await deleteCommentRoute(req('http://x/d', 'DELETE'), params(comment.id))).status).toBe(200);
    session.user = boss;
    expect((await deleteCommentRoute(req('http://x/d', 'DELETE'), params(answer.id))).status).toBe(200);
    expect(await listComments(item.id)).toEqual([]);
    expect((await getRoadmapItem(item.id))!.comment_count).toBe(0);
  });

  it('lib: autorización directa y suscripción del comentarista', async () => {
    const item = await makeItem();
    const u = await makeUser('bc-lib');
    const other = await makeUser('bc-lib2');
    const res = await addComment({ itemId: item.id, userId: u.id, body: 'hola', locale: 'pt' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await deleteComment(res.comment.id, other.id, false)).toEqual({ ok: false, error: 'forbidden' });
    expect(await moderateComment(res.comment.id, { official: true }, false)).toEqual({ ok: false, error: 'forbidden' });
    const sub = (await getDb()
      .prepare('SELECT reason, locale FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?')
      .get(item.id, u.id)) as { reason: string; locale: string };
    expect(sub).toEqual({ reason: 'comment', locale: 'pt' });
    const privateItem = await makeItem({ is_public: 0 });
    expect(await addComment({ itemId: privateItem.id, userId: u.id, body: 'x' })).toEqual({ ok: false, error: 'not_found' });
  });
});

// ---------------------------------------------------------------------------

describe('board: notificaciones', () => {
  it('sin RESEND_API_KEY no manda emails pero deja la notificación in-app', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const item = await makeItem({ status: 'considering' });
    const u = await makeUser('bn-voter');
    await toggleVote(item.id, u.id);
    const planned = (await updateRoadmapItem(item.id, { status: 'planned' }))!;
    const res = await notifyStatusChange(planned, 'considering');
    expect(res).toEqual({ notified: 1, emailed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    const notes = (await getDb()
      .prepare("SELECT type, href FROM notifications WHERE user_id = ? AND type = 'roadmap_status'")
      .all(u.id)) as Array<{ type: string; href: string }>;
    // Una por updateRoadmapItem (en línea fuera de una request) y otra por la llamada directa.
    expect(notes.length).toBe(2);
    expect(notes[0].href).toBe(`/feedback-board/i/${itemRef(item.id, item.title)}`);
  });

  it('con RESEND_API_KEY manda un email por suscripto activo, con link para desuscribirse', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const sent: Array<{ to: string; text: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)) as { to: string; text: string });
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    });
    const item = await makeItem({ status: 'planned' });
    const a = await makeUser('bn-a');
    const b = await makeUser('bn-b');
    await toggleVote(item.id, a.id);
    await toggleVote(item.id, b.id);
    await getDb().prepare('UPDATE roadmap_subscriptions SET active = 0 WHERE item_id = ? AND user_id = ?').run(item.id, b.id);
    const done = { ...(await getRoadmapItem(item.id))!, status: 'done' as const, shipped_changelog_id: 'entry-1' };
    expect(await notifyStatusChange(done, 'planned')).toEqual({ notified: 1, emailed: 1 });
    expect(sent.map((m) => m.to)).toEqual([a.email]);
    expect(sent[0].text).toContain('/api/board/unsubscribe?');
    expect(sent[0].text).toContain('#entry-1');
    const token = unsubscribeToken(item.id, a.id);
    expect(verifyUnsubscribeToken(item.id, a.id, token)).toBe(true);
    expect(verifyUnsubscribeToken(item.id, b.id, token)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('board: subdominios y login cross-host', () => {
  it('detecta feedback.<dominio> y branding.<dominio> (default y por env)', () => {
    expect(surfaceForHost('feedback.zerosoft.ai')).toBe('board');
    expect(surfaceForHost('FEEDBACK.zerosoft.ai:443')).toBe('board');
    expect(surfaceForHost('branding.zerosoft.ai')).toBe('brand');
    expect(surfaceForHost('zerosoft.ai')).toBeNull();
    expect(surfaceForHost('go.cliente.com')).toBeNull();
    expect(surfaceForHost('feedback.localhost:3000')).toBe('board');
    process.env.FEEDBACK_HOST = 'ideas.example.com, feedback.example.com';
    process.env.BRANDING_HOST = 'https://brand.example.com';
    expect(surfaceForHost('ideas.example.com')).toBe('board');
    expect(surfaceForHost('feedback.example.com')).toBe('board');
    expect(surfaceForHost('feedback.zerosoft.ai')).toBeNull();
    expect(surfaceForHost('brand.example.com')).toBe('brand');
  });

  it('reescribe / y /<path> bajo el prefijo con el locale correcto', () => {
    expect(surfaceRewritePath('board', '/', 'es')).toEqual({ path: '/es/feedback-board', locale: 'es' });
    expect(surfaceRewritePath('board', '/i/abc-titulo', 'pt')).toEqual({ path: '/pt/feedback-board/i/abc-titulo', locale: 'pt' });
    expect(surfaceRewritePath('board', '/en/roadmap', 'es')).toEqual({ path: '/en/feedback-board/roadmap', locale: 'en' });
    expect(surfaceRewritePath('board', '/es', 'en')).toEqual({ path: '/es/feedback-board', locale: 'es' });
    expect(surfaceRewritePath('board', '/es/feedback-board/i/x', 'en')).toEqual({ path: '/es/feedback-board/i/x', locale: 'es' });
    // "/english" no es un locale.
    expect(surfaceRewritePath('board', '/english', 'en')).toEqual({ path: '/en/feedback-board/english', locale: 'en' });
    expect(surfaceRewritePath('board', '/x', 'fr')).toEqual({ path: '/en/feedback-board/x', locale: 'en' });
    expect(surfaceRewritePath('brand', '/', 'pt')).toEqual({ path: '/pt/brand', locale: 'pt' });
    expect(surfaceRewritePath('brand', '/logo', 'es')).toEqual({ path: '/es/brand/logo', locale: 'es' });
  });

  it('el subdominio del board es host de la app, no un dominio de Link', () => {
    expect(isAppHost('feedback.zerosoft.ai')).toBe(true);
    expect(isAppHost('branding.zerosoft.ai')).toBe(true);
    expect(isAppHost('go.cliente.com')).toBe(false);
    process.env.FEEDBACK_HOST = 'ideas.example.com';
    expect(isAppHost('ideas.example.com')).toBe(true);
  });

  it('middleware: la regla de superficie va antes de dominios propios y short links', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');
    const surface = src.indexOf('surfaceForHost(');
    expect(surface).toBeGreaterThan(0);
    expect(surface).toBeLessThan(src.indexOf('if (!isAppHost('));
    expect(surface).toBeLessThan(src.indexOf('Short links en la raíz'));
  });

  it('cookie de sesión compartida solo cuando NEXTAUTH_URL es *.zerosoft.ai', () => {
    expect(sessionCookieDomain('https://zerosoft.ai', undefined)).toBe('.zerosoft.ai');
    expect(sessionCookieDomain('https://app.zerosoft.ai', undefined)).toBe('.zerosoft.ai');
    expect(sessionCookieDomain('https://zerosoft.ai.evil.com', undefined)).toBeUndefined();
    expect(sessionCookieDomain('https://selfhost.example.com', undefined)).toBeUndefined();
    expect(sessionCookieDomain('http://localhost:3000', undefined)).toBeUndefined();
    expect(sessionCookieDomain(undefined, undefined)).toBeUndefined();
    expect(sessionCookieDomain('https://app.example.com', '.example.com')).toBe('.example.com');
    // Override fuera del dominio de NEXTAUTH_URL: se ignora.
    expect(sessionCookieDomain('https://zerosoft.ai', 'cliente.com')).toBeUndefined();
  });

  it('callbackUrl del login: paths del sitio y hosts de la app; nunca dominios de Link', () => {
    const base = 'https://zerosoft.ai';
    expect(safeCallbackUrl('/es/feedback-board/i/x', base)).toBe('/es/feedback-board/i/x');
    expect(safeCallbackUrl('//evil.com/x', base)).toBeNull();
    expect(safeCallbackUrl('https://feedback.zerosoft.ai/es/i/x', base)).toBe('https://feedback.zerosoft.ai/es/i/x');
    expect(safeCallbackUrl('https://go.cliente.com/x', base)).toBeNull();
    expect(safeCallbackUrl('javascript:alert(1)', base)).toBeNull();
    expect(isTrustedReturnUrl('https://zerosoft.ai/es/app', base)).toBe(true);
    expect(isTrustedReturnUrl('https://random.vercel.app/', base)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('changelog: repo + base', () => {
  const staticEntries: ChangelogEntry[] = [
    { id: 's-new', date: '2026-10-13', title: { en: 'S new', es: 'S nuevo', pt: 'S novo' }, items: [{ product: 'cal', en: 'a', es: 'a', pt: 'a' }] },
    { id: 's-old', date: '2026-09-01', title: { en: 'S old', es: 'S viejo', pt: 'S velho' }, items: [{ product: 'link', en: 'b', es: 'b', pt: 'b' }] },
  ];
  function row(id: string, date: string, extra: Partial<ChangelogEntryRow> = {}): ChangelogEntryRow {
    return {
      id,
      date,
      title_en: `T ${id}`,
      title_es: '',
      title_pt: '',
      body_en: 'Body **en**',
      body_es: '',
      body_pt: '',
      products: '["crm"]',
      published: 1,
      created_by: null,
      created_at: '2026-10-14T00:00:00.000Z',
      updated_at: '2026-10-14T00:00:00.000Z',
      ...extra,
    };
  }

  it('ordena por fecha; en el mismo día la base va arriba; si choca el id gana el repo', () => {
    const merged = mergeChangelog(
      staticEntries,
      [row('d-2', '2026-10-20'), row('d-1', '2026-10-13'), row('s-old', '2026-12-01')],
      new Map([['d-1', [{ id: 'i1', title: 'Idea 1' }]]]),
    );
    expect(merged.map((e) => e.id)).toEqual(['d-2', 'd-1', 's-new', 's-old']);
    expect(merged[1]).toMatchObject({ source: 'db', products: ['crm'], closed: [{ id: 'i1', title: 'Idea 1' }] });
    // Sin es/pt: usa el inglés.
    expect(merged[1].title.es).toBe('T d-1');
    expect(merged[1].body!.es).toContain('<strong>en</strong>');
    expect(merged[3]).toMatchObject({ source: 'static', products: ['link'] });
  });

  it('el markdown del changelog se sanitiza', () => {
    const html = renderChangelogMarkdown('# Título\n\n<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).toContain('<h3>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  it('publicar una entrada cierra ítems (done + link + evento) y aparece en el changelog unificado', async () => {
    process.env.ADMIN_EMAILS = 'boss-cl@test.local';
    const boss = await makeUser('cl-boss');
    await getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run('boss-cl@test.local', boss.id);
    const a = await makeItem({ status: 'in_progress', title: 'Cerrar A' });
    const b = await makeItem({ status: 'proposed', is_public: 0, title: 'Cerrar B' });
    const input = {
      date: '2026-10-16',
      titleEn: 'Board launch',
      titleEs: 'Lanzamos el board',
      bodyEn: 'Votes and comments.',
      products: ['platform'],
      closesItemIds: [a.id, b.id],
    };
    session.user = await makeUser('cl-other');
    expect((await changelogRoute(req('http://x/cl', 'POST', input))).status).toBe(404);
    session.user = { ...boss, email: 'boss-cl@test.local' };
    const res = await changelogRoute(req('http://x/cl', 'POST', input));
    expect(res.status).toBe(201);
    const { entry } = (await res.json()) as { entry: ChangelogEntryRow };
    expect(entry.id).toBe('2026-10-16-board-launch');
    for (const id of [a.id, b.id]) {
      const item = (await getRoadmapItem(id))!;
      expect(item).toMatchObject({ status: 'done', shipped_changelog_id: entry.id, is_public: 1 });
    }
    const ev = (await getDb()
      .prepare("SELECT changelog_id FROM roadmap_status_events WHERE item_id = ? AND to_status = 'done'")
      .get(a.id)) as { changelog_id: string };
    expect(ev.changelog_id).toBe(entry.id);
    const draft = await createChangelogEntry(
      { ...input, titleEn: 'Hidden draft', titleEs: '', titlePt: '', bodyEs: '', bodyPt: '', published: false, closesItemIds: [] , products: [] },
      boss.id,
    );
    const unified = await getUnifiedChangelog();
    const found = unified.find((e) => e.id === entry.id)!;
    expect(found.title.es).toBe('Lanzamos el board');
    expect(found.closed.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(unified.some((e) => e.id === draft.id)).toBe(false);
    // Un id del repo sigue estando.
    expect(unified.some((e) => e.source === 'static')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('admin: promover feedback a ítem', () => {
  it('crea un ítem público o adjunta a uno existente, moviendo la señal', async () => {
    process.env.ADMIN_EMAILS = 'boss-fb@test.local';
    const boss = await makeUser('fb-boss');
    await getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run('boss-fb@test.local', boss.id);
    const { createFeedback } = await import('@/lib/feedback');
    const fb = await createFeedback({ kind: 'idea', product: 'track', message: 'Quiero sub-tareas recurrentes' });

    session.user = await makeUser('fb-nobody');
    expect((await promoteRoute(req('http://x/p', 'POST', { itemId: 'x' }), params(fb.id))).status).toBe(404);

    session.user = { ...boss, email: 'boss-fb@test.local' };
    const created = await promoteRoute(
      req('http://x/p', 'POST', { create: { title: 'Sub-tareas recurrentes', product: 'track' } }),
      params(fb.id),
    );
    expect(created.status).toBe(200);
    const { item } = (await created.json()) as { item: RoadmapItemRow };
    expect(item).toMatchObject({ status: 'idea', is_public: 1, votes: 1 });

    const other = await makeItem({ status: 'planned', product: 'track' });
    const attached = await promoteRoute(req('http://x/p', 'POST', { itemId: other.id }), params(fb.id));
    expect(((await attached.json()) as { item: RoadmapItemRow }).item.votes).toBe(1);
    expect((await getRoadmapItem(item.id))!.votes).toBe(0);
    const status = (await getDb().prepare('SELECT status FROM feedback WHERE id = ?').get(fb.id)) as { status: string };
    expect(status.status).toBe('read');
  });
});

// ---------------------------------------------------------------------------

describe('board: createIdea', () => {
  it('registra el evento inicial y suscribe al autor', async () => {
    const u = await makeUser('ci');
    const item = await createIdea({ userId: u.id, title: 'Modo oscuro en Docs', description: '', product: 'docs', locale: 'es' });
    const events = (await getDb().prepare('SELECT from_status, to_status FROM roadmap_status_events WHERE item_id = ?').all(item.id)) as Array<{
      from_status: string | null;
      to_status: string;
    }>;
    expect(events).toEqual([{ from_status: null, to_status: 'idea' }]);
    const sub = (await getDb()
      .prepare('SELECT reason FROM roadmap_subscriptions WHERE item_id = ? AND user_id = ?')
      .get(item.id, u.id)) as { reason: string };
    expect(sub.reason).toBe('author');
  });
});
