/**
 * Social en el cron de cada minuto (/api/cron/minute). Cada paso reclama su
 * fila con compare-and-set antes de tocar la red, así dos corridas a la vez
 * no publican dos veces:
 *
 * - Publicar: destinos pending/retry vencidos → 'publishing' (claimed_until
 *   +5 min, attempts+1). Si la red procesa en diferido (Instagram, Threads,
 *   TikTok) queda 'processing' y se vuelve a mirar en un minuto. Los errores
 *   pasajeros reintentan con backoff (1, 5, 15, 60 min) hasta MAX_ATTEMPTS;
 *   los permanentes (token vencido, contenido rechazado) fallan enseguida.
 *   Un claim vencido (corrida que murió a la mitad) vuelve a 'retry'.
 * - Tokens: los que vencen en menos de 30 min se refrescan (claim en
 *   refresh_claimed_until); si la red dice que no, la cuenta queda "expired"
 *   y la pantalla pide reconectar.
 * - Bandeja: polling cada 5 min por cuenta (claim en inbox_claimed_until).
 * - Métricas: cada hora por cuenta (claim en metrics_claimed_until).
 */
import { getDb } from './db';
import { seal } from './secret-box';
import { credsOf, personMayPublish, providerFor, recomputePostStatus, sendBackToApproval } from './social';
import { NETWORK_SPECS, socialFake, textFor, type MediaItem, type SocialNetwork } from './social-networks';
import { SocialApiError, type AccountCreds } from './social-providers';
import { backoffMs, isPermanentError, MAX_ATTEMPTS } from './social-schedule';

const db = () => getDb();
const iso = (ms: number = Date.now()) => new Date(ms).toISOString();
const CLAIM_MS = 5 * 60_000;
const PROCESSING_TIMEOUT_MS = 2 * 60 * 60_000;
const INBOX_EVERY_MS = 5 * 60_000;
const METRICS_EVERY_MS = 60 * 60_000;

type AccountRow = Parameters<typeof credsOf>[0] & { workspace_id: string; status: string; token_expires_at: string | null };

interface DueTarget {
  id: string;
  post_id: string;
  account_id: string;
  text_override: string | null;
  status: string;
  attempts: number;
  publish_ref: string | null;
  updated_at: string;
}

function errorOf(err: unknown): { code: string; message: string } {
  if (err instanceof SocialApiError) return { code: err.code, message: err.message };
  return { code: 'network', message: 'Unexpected error' };
}

async function markAccountExpired(accountId: string, message: string) {
  await db().prepare("UPDATE social_accounts SET status = 'expired', status_error = ?, updated_at = ? WHERE id = ?").run(message.slice(0, 300), iso(), accountId);
}

/** Después de publicar algo, la bandeja y las métricas de esa cuenta se miran pronto. */
async function bumpAccount(accountId: string) {
  const soon = iso(Date.now() + (socialFake() ? 0 : 10 * 60_000));
  await db()
    .prepare('UPDATE social_accounts SET inbox_due_at = MIN(COALESCE(inbox_due_at, ?), ?), metrics_due_at = MIN(COALESCE(metrics_due_at, ?), ?) WHERE id = ?')
    .run(soon, soon, soon, soon, accountId);
}

async function finishTarget(t: DueTarget, acc: AccountCreds, externalId: string, url: string | null, firstComment: string | null) {
  let commentStatus: string | null = null;
  if (firstComment && NETWORK_SPECS[acc.network].firstComment) {
    const provider = providerFor(acc.network);
    try {
      await provider.comment?.(acc, externalId, firstComment);
      commentStatus = 'sent';
    } catch {
      commentStatus = 'failed';
    }
  }
  const t2 = iso();
  await db()
    .prepare(
      `UPDATE social_post_targets SET status = 'published', external_id = ?, external_url = ?, published_at = ?, comment_status = ?,
         error_code = NULL, error_message = NULL, claimed_until = NULL, publish_ref = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(externalId, url, t2, commentStatus, t2, t.id);
  await bumpAccount(t.account_id);
}

async function failTarget(t: DueTarget, attempts: number, err: { code: string; message: string }) {
  const permanent = isPermanentError(err.code) || attempts >= MAX_ATTEMPTS;
  const t2 = iso();
  if (permanent) {
    await db()
      .prepare("UPDATE social_post_targets SET status = 'failed', error_code = ?, error_message = ?, claimed_until = NULL, updated_at = ? WHERE id = ?")
      .run(err.code, err.message.slice(0, 300), t2, t.id);
  } else {
    await db()
      .prepare("UPDATE social_post_targets SET status = 'retry', error_code = ?, error_message = ?, next_attempt_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?")
      .run(err.code, err.message.slice(0, 300), iso(Date.now() + backoffMs(attempts)), t2, t.id);
  }
}

/** Publica un destino ya reclamado. */
async function publishTarget(t: DueTarget, attempts: number, checking: boolean): Promise<void> {
  const post = (await db().prepare('SELECT text, media, first_comment, status, workspace_id FROM social_posts WHERE id = ?').get(t.post_id)) as
    | { text: string; media: string; first_comment: string | null; status: string; workspace_id: string }
    | undefined;
  const accRow = (await db().prepare('SELECT * FROM social_accounts WHERE id = ?').get(t.account_id)) as AccountRow | undefined;
  if (!post) return;
  if (!accRow) return failTarget(t, attempts, { code: 'account_disconnected', message: 'The account was disconnected' });
  if (accRow.status === 'expired') return failTarget(t, attempts, { code: 'token_expired', message: 'Reconnect the account and retry' });
  const acc = credsOf(accRow);
  const provider = providerFor(acc.network);
  let media: MediaItem[] = [];
  try {
    media = JSON.parse(post.media || '[]') as MediaItem[];
  } catch {
    media = [];
  }
  try {
    const result =
      checking && t.publish_ref && provider.checkPublish
        ? await provider.checkPublish(acc, t.publish_ref)
        : await provider.publish(acc, { text: textFor(post.text, t.text_override), media, attempt: attempts });
    if (result.done) {
      await finishTarget(t, acc, result.externalId, result.url, post.first_comment);
    } else {
      // updated_at marca desde cuándo procesa (el chequeo no lo mueve): a las 2 h se da por perdido.
      await db()
        .prepare("UPDATE social_post_targets SET status = 'processing', publish_ref = ?, next_attempt_at = ?, claimed_until = NULL, updated_at = ? WHERE id = ?")
        .run(result.ref, iso(Date.now() + (socialFake() ? 0 : 60_000)), checking ? t.updated_at : iso(), t.id);
    }
  } catch (err) {
    const e = errorOf(err);
    if (e.code === 'token_expired') await markAccountExpired(acc.id, e.message);
    await failTarget(t, attempts, e);
  }
}

/** Publica lo vencido. Devuelve cuántos destinos se intentaron. */
export async function publishDue(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ attempted: number; published: number; failed: number }> {
  const start = Date.now();
  const nowIso = iso();
  // Claims vencidos (una corrida que murió publicando): no se sabe si la red lo
  // publicó, así que no se reintenta solo. Queda en "falló" con unknown_state:
  // la persona mira la red y reintenta a mano si no salió.
  const stale = (await db()
    .prepare("SELECT DISTINCT post_id FROM social_post_targets WHERE status = 'publishing' AND claimed_until < ?")
    .all(nowIso)) as Array<{ post_id: string }>;
  if (stale.length) {
    await db()
      .prepare(
        `UPDATE social_post_targets SET status = 'failed', error_code = 'unknown_state', error_message = NULL, claimed_until = NULL, updated_at = ?
         WHERE status = 'publishing' AND claimed_until < ?`,
      )
      .run(nowIso, nowIso);
    for (const s of stale) await recomputePostStatus(s.post_id);
  }
  const due = (await db()
    .prepare(
      `SELECT t.id, t.post_id, t.account_id, t.text_override, t.status, t.attempts, t.publish_ref, t.updated_at FROM social_post_targets t
       JOIN social_posts p ON p.id = t.post_id
       WHERE t.status IN ('pending', 'retry', 'processing') AND t.next_attempt_at <= ? AND p.status IN ('scheduled', 'publishing')
       ORDER BY t.next_attempt_at LIMIT ?`,
    )
    .all(nowIso, opts.limit ?? 50)) as DueTarget[];
  let attempted = 0;
  const touched = new Set<string>();
  const paused = new Set<string>();
  for (const t of due) {
    if (opts.budgetMs && Date.now() - start > opts.budgetMs) break;
    if (paused.has(t.post_id)) continue;
    const checking = t.status === 'processing';
    // Quien responde por la publicación (quien la aprobó, o quien la creó) tiene que poder publicar hoy en esa cuenta:
    // si salió del workspace, perdió Social o la cuenta, vuelve a aprobación en vez de salir.
    if (!checking) {
      const owner = (await db().prepare('SELECT workspace_id, created_by, approval_by FROM social_posts WHERE id = ?').get(t.post_id)) as
        | { workspace_id: string; created_by: string; approval_by: string | null }
        | undefined;
      if (owner && !(await personMayPublish(owner.workspace_id, owner.approval_by ?? owner.created_by, t.account_id))) {
        // A mitad de publicar (otra cuenta ya salió) no se puede volver a aprobación: este destino falla.
        if (!(await sendBackToApproval(t.post_id, null, 'author_access'))) {
          await failTarget(t, MAX_ATTEMPTS, { code: 'author_access', message: 'The person behind this post can no longer post to this account' });
          touched.add(t.post_id);
        }
        paused.add(t.post_id);
        continue;
      }
    }
    if (checking && Date.now() - new Date(t.updated_at).getTime() > PROCESSING_TIMEOUT_MS && t.attempts > 0) {
      await failTarget(t, MAX_ATTEMPTS, { code: 'unknown_state', message: 'The network did not confirm the post in 2 hours' });
      touched.add(t.post_id);
      continue;
    }
    // Compare-and-set: solo una corrida gana el destino.
    const claim = await db()
      .prepare(
        `UPDATE social_post_targets SET status = 'publishing', claimed_until = ?, attempts = attempts + ?, updated_at = ?
         WHERE id = ? AND status = ? AND next_attempt_at <= ? AND (claimed_until IS NULL OR claimed_until < ?)`,
      )
      .run(iso(Date.now() + CLAIM_MS), checking ? 0 : 1, checking ? t.updated_at : iso(), t.id, t.status, nowIso, nowIso);
    if (claim.changes !== 1) continue;
    attempted++;
    await db().prepare("UPDATE social_posts SET status = 'publishing', updated_at = ? WHERE id = ? AND status = 'scheduled'").run(iso(), t.post_id);
    await publishTarget(t, checking ? t.attempts : t.attempts + 1, checking);
    touched.add(t.post_id);
  }
  for (const id of touched) await recomputePostStatus(id);
  const ids = [...touched];
  const counts = ids.length
    ? ((await db()
        .prepare(`SELECT SUM(status = 'published') AS ok, SUM(status = 'failed') AS bad FROM social_post_targets WHERE post_id IN (${ids.map(() => '?').join(',')})`)
        .get(...ids)) as { ok: number | null; bad: number | null })
    : { ok: 0, bad: 0 };
  return { attempted, published: Number(counts.ok ?? 0), failed: Number(counts.bad ?? 0) };
}

/** Refresca los tokens que están por vencer; los que no se pueden quedan "expired". */
export async function refreshTokens(opts: { limit?: number } = {}): Promise<{ refreshed: number; expired: number }> {
  const nowMs = Date.now();
  const soon = iso(nowMs + 30 * 60_000);
  const rows = (await db()
    .prepare(
      `SELECT * FROM social_accounts WHERE status = 'connected' AND token_expires_at IS NOT NULL AND token_expires_at < ?
       AND (refresh_claimed_until IS NULL OR refresh_claimed_until < ?) LIMIT ?`,
    )
    .all(soon, iso(nowMs), opts.limit ?? 25)) as AccountRow[];
  let refreshed = 0;
  let expired = 0;
  for (const r of rows) {
    const claim = await db()
      .prepare('UPDATE social_accounts SET refresh_claimed_until = ? WHERE id = ? AND (refresh_claimed_until IS NULL OR refresh_claimed_until < ?)')
      .run(iso(Date.now() + CLAIM_MS), r.id, iso());
    if (claim.changes !== 1) continue;
    const acc = credsOf(r);
    const provider = providerFor(acc.network);
    try {
      const tokens = provider.refresh && acc.refreshToken ? await provider.refresh(acc) : null;
      if (!tokens) {
        if (r.token_expires_at && r.token_expires_at < iso()) {
          await markAccountExpired(r.id, 'The access token expired');
          expired++;
        }
        await db().prepare('UPDATE social_accounts SET refresh_claimed_until = NULL WHERE id = ?').run(r.id);
        continue;
      }
      await db()
        .prepare(
          `UPDATE social_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at),
             refresh_claimed_until = NULL, status_error = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(seal(tokens.accessToken), tokens.refreshToken ? seal(tokens.refreshToken) : null, tokens.expiresAt ?? null, tokens.refreshExpiresAt ?? null, iso(), r.id);
      refreshed++;
    } catch (err) {
      const e = errorOf(err);
      if (e.code === 'token_expired' || e.code === 'not_authorized' || e.code === 'invalid_content') {
        await markAccountExpired(r.id, e.message);
        expired++;
      }
      // Error de red: se vuelve a intentar en la próxima corrida (el claim vence solo).
    }
  }
  return { refreshed, expired };
}

async function claimAccounts(column: 'inbox' | 'metrics', limit: number): Promise<AccountRow[]> {
  const nowIso = iso();
  const due = `${column}_due_at`;
  const claimed = `${column}_claimed_until`;
  const rows = (await db()
    .prepare(
      `SELECT * FROM social_accounts WHERE status = 'connected' AND (${due} IS NULL OR ${due} <= ?) AND (${claimed} IS NULL OR ${claimed} < ?)
       ORDER BY COALESCE(${due}, '') LIMIT ?`,
    )
    .all(nowIso, nowIso, limit)) as AccountRow[];
  const out: AccountRow[] = [];
  for (const r of rows) {
    const res = await db()
      .prepare(`UPDATE social_accounts SET ${claimed} = ? WHERE id = ? AND (${claimed} IS NULL OR ${claimed} < ?) AND (${due} IS NULL OR ${due} <= ?)`)
      .run(iso(Date.now() + CLAIM_MS), r.id, nowIso, nowIso);
    if (res.changes === 1) out.push(r);
  }
  return out;
}

async function recentPosts(accountId: string, days: number): Promise<Array<{ id: string; external_id: string }>> {
  return (await db()
    .prepare("SELECT id, external_id FROM social_post_targets WHERE account_id = ? AND status = 'published' AND external_id IS NOT NULL AND published_at >= ? ORDER BY published_at DESC LIMIT 50")
    .all(accountId, iso(Date.now() - days * 86_400_000))) as Array<{ id: string; external_id: string }>;
}

/** Inserta lo que llegó a la bandeja (sin duplicar). Devuelve cuántos son nuevos. */
export async function storeInboxItems(
  workspaceId: string,
  accountId: string,
  items: Array<{ kind: string; externalId: string; threadRef?: string | null; postExternalId?: string | null; authorName: string; authorHandle?: string | null; authorId?: string | null; text: string; receivedAt: string }>,
): Promise<number> {
  let added = 0;
  for (const it of items.slice(0, 200)) {
    const target = it.postExternalId
      ? ((await db().prepare('SELECT id FROM social_post_targets WHERE account_id = ? AND external_id = ?').get(accountId, it.postExternalId)) as { id: string } | undefined)
      : undefined;
    const received = Number.isNaN(new Date(it.receivedAt).getTime()) ? iso() : new Date(it.receivedAt).toISOString();
    const res = await db()
      .prepare(
        `INSERT OR IGNORE INTO social_inbox (id, workspace_id, account_id, kind, external_id, thread_ref, target_id, author_name, author_handle, author_id, text, received_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        crypto.randomUUID(),
        workspaceId,
        accountId,
        it.kind,
        it.externalId.slice(0, 500),
        it.threadRef?.slice(0, 2000) ?? null,
        target?.id ?? null,
        (it.authorName || '').slice(0, 200),
        it.authorHandle?.slice(0, 200) ?? null,
        it.authorId?.slice(0, 200) ?? null,
        (it.text || '').slice(0, 8000),
        received,
        iso(),
      );
    added += res.changes;
  }
  return added;
}

/** Polling de la bandeja (comentarios, menciones, DMs) de las cuentas vencidas. */
export async function pollInbox(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ accounts: number; added: number }> {
  const start = Date.now();
  const rows = await claimAccounts('inbox', opts.limit ?? 10);
  let added = 0;
  for (const r of rows) {
    if (opts.budgetMs && Date.now() - start > opts.budgetMs) {
      await db().prepare('UPDATE social_accounts SET inbox_claimed_until = NULL WHERE id = ?').run(r.id);
      continue;
    }
    const acc = credsOf(r);
    const provider = providerFor(acc.network);
    const spec = NETWORK_SPECS[acc.network as SocialNetwork];
    try {
      if (provider.fetchInbox && spec.inbox.length) {
        const posts = await recentPosts(r.id, 14);
        const res = await provider.fetchInbox(acc, { cursor: (r as unknown as { inbox_cursor: string | null }).inbox_cursor ?? null, posts: posts.map((p) => p.external_id) });
        added += await storeInboxItems(r.workspace_id, r.id, res.items);
        if (res.cursor !== undefined) await db().prepare('UPDATE social_accounts SET inbox_cursor = ? WHERE id = ?').run(res.cursor, r.id);
      }
    } catch (err) {
      const e = errorOf(err);
      if (e.code === 'token_expired') await markAccountExpired(r.id, e.message);
    }
    await db().prepare('UPDATE social_accounts SET inbox_due_at = ?, inbox_claimed_until = NULL WHERE id = ?').run(iso(Date.now() + INBOX_EVERY_MS), r.id);
  }
  return { accounts: rows.length, added };
}

/** Métricas de las publicaciones (últimos 30 días) y de la cuenta (seguidores por día). */
export async function pullMetrics(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ accounts: number; posts: number }> {
  const start = Date.now();
  const rows = await claimAccounts('metrics', opts.limit ?? 10);
  let posts = 0;
  for (const r of rows) {
    if (opts.budgetMs && Date.now() - start > opts.budgetMs) {
      await db().prepare('UPDATE social_accounts SET metrics_claimed_until = NULL WHERE id = ?').run(r.id);
      continue;
    }
    const acc = credsOf(r);
    const provider = providerFor(acc.network);
    const t = iso();
    try {
      const recent = await recentPosts(r.id, 30);
      if (provider.postMetrics && recent.length) {
        const m = await provider.postMetrics(acc, recent.map((p) => p.external_id));
        for (const p of recent) {
          const v = m[p.external_id];
          if (!v) continue;
          await db()
            .prepare(
              `UPDATE social_post_targets SET impressions = ?, reach = ?, engagement = ?, likes = ?, comments = ?, shares = ?, clicks = ?, views = ?, metrics_at = ? WHERE id = ?`,
            )
            .run(v.impressions ?? null, v.reach ?? null, v.engagement ?? null, v.likes ?? null, v.comments ?? null, v.shares ?? null, v.clicks ?? null, v.views ?? null, t, p.id);
          posts++;
        }
      }
      const a = provider.accountMetrics ? await provider.accountMetrics(acc) : {};
      const totals = (await db()
        .prepare("SELECT SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(engagement) AS engagement FROM social_post_targets WHERE account_id = ? AND status = 'published'")
        .get(r.id)) as { impressions: number | null; reach: number | null; engagement: number | null };
      await db()
        .prepare(
          `INSERT INTO social_account_stats (account_id, day, followers, impressions, reach, engagement) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, day) DO UPDATE SET followers = COALESCE(excluded.followers, followers), impressions = excluded.impressions, reach = excluded.reach, engagement = excluded.engagement`,
        )
        .run(r.id, t.slice(0, 10), a.followers ?? null, totals.impressions ?? null, totals.reach ?? null, totals.engagement ?? null);
      if (a.followers != null) await db().prepare('UPDATE social_accounts SET followers = ? WHERE id = ?').run(a.followers, r.id);
    } catch (err) {
      const e = errorOf(err);
      if (e.code === 'token_expired') await markAccountExpired(r.id, e.message);
    }
    await db().prepare('UPDATE social_accounts SET metrics_due_at = ?, metrics_claimed_until = NULL WHERE id = ?').run(iso(Date.now() + METRICS_EVERY_MS), r.id);
  }
  return { accounts: rows.length, posts };
}

/** Todo Social en una corrida del cron, con presupuesto de tiempo. */
export async function runSocialCron(opts: { budgetMs?: number } = {}) {
  const budget = opts.budgetMs ?? 30_000;
  const start = Date.now();
  const left = () => Math.max(1_000, budget - (Date.now() - start));
  const publish = await publishDue({ budgetMs: left() });
  const tokens = await refreshTokens().catch(() => null);
  const inbox = await pollInbox({ budgetMs: left() }).catch(() => null);
  const metrics = await pullMetrics({ budgetMs: left() }).catch(() => null);
  // Estados de OAuth vencidos y eventos de webhooks viejos.
  await db().prepare('DELETE FROM social_oauth_states WHERE expires_at < ?').run(iso()).catch(() => undefined);
  await db().prepare('DELETE FROM social_webhook_events WHERE created_at < ?').run(iso(Date.now() - 3 * 86_400_000)).catch(() => undefined);
  return { publish, tokens, inbox, metrics };
}
