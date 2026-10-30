/**
 * Social: reporte de métricas (cuentas que la persona ve), CSV y mejores
 * horarios. Las métricas las trae el cron cada hora (lib/social-cron.ts).
 */
import { getDb } from './db';
import { SocialError, visibleAccountIds, visibleAccountRows, type SocialActor } from './social';
import { NETWORK_SPECS, type SocialNetwork } from './social-networks';
import { bestTimes, type BestTime } from './social-schedule';

const db = () => getDb();

export interface AnalyticsReport {
  days: number;
  from: string;
  totals: { posts: number; impressions: number; reach: number; engagement: number; clicks: number; engagementRate: number | null };
  accounts: Array<{ id: string; name: string; network: SocialNetwork; networkName: string; followers: number | null; followersDelta: number | null; posts: number; impressions: number; engagement: number }>;
  perDay: Array<{ day: string; posts: number; impressions: number; engagement: number }>;
  posts: Array<{ postId: string; targetId: string; text: string; account: string; network: SocialNetwork; publishedAt: string; url: string | null; impressions: number | null; reach: number | null; engagement: number | null; likes: number | null; comments: number | null; shares: number | null; clicks: number | null }>;
  /** Cuándo se trajeron las métricas por última vez (null = todavía nunca). */
  updatedAt: string | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function socialAnalytics(actor: SocialActor, opts: { days?: number; accountId?: string } = {}): Promise<AnalyticsReport> {
  const days = [7, 30, 90].includes(Number(opts.days)) ? Number(opts.days) : 30;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  let accounts = await visibleAccountRows(actor);
  if (opts.accountId) {
    accounts = accounts.filter((a) => a.id === opts.accountId);
    if (!accounts.length) throw new SocialError(404, 'not_found');
  }
  const ids = accounts.map((a) => a.id);
  const empty: AnalyticsReport = { days, from, totals: { posts: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0, engagementRate: null }, accounts: [], perDay: [], posts: [], updatedAt: null };
  if (!ids.length) return empty;
  const marks = ids.map(() => '?').join(',');
  const rows = (await db()
    .prepare(
      `SELECT t.id, t.post_id, t.account_id, t.published_at, t.external_url, t.impressions, t.reach, t.engagement, t.likes, t.comments, t.shares, t.clicks, t.metrics_at,
              COALESCE(NULLIF(t.text_override, ''), p.text) AS text
       FROM social_post_targets t JOIN social_posts p ON p.id = t.post_id
       WHERE t.account_id IN (${marks}) AND t.status = 'published' AND t.published_at >= ? ORDER BY t.published_at DESC`,
    )
    .all(...ids, from)) as Array<{
    id: string;
    post_id: string;
    account_id: string;
    published_at: string;
    external_url: string | null;
    impressions: number | null;
    reach: number | null;
    engagement: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    clicks: number | null;
    metrics_at: string | null;
    text: string;
  }>;
  const stats = (await db()
    .prepare(`SELECT account_id, day, followers FROM social_account_stats WHERE account_id IN (${marks}) AND day >= ? ORDER BY day`)
    .all(...ids, from.slice(0, 10))) as Array<{ account_id: string; day: string; followers: number | null }>;
  const totals = {
    posts: rows.length,
    impressions: rows.reduce((s, r) => s + n(r.impressions), 0),
    reach: rows.reduce((s, r) => s + n(r.reach), 0),
    engagement: rows.reduce((s, r) => s + n(r.engagement), 0),
    clicks: rows.reduce((s, r) => s + n(r.clicks), 0),
    engagementRate: null as number | null,
  };
  totals.engagementRate = totals.impressions > 0 ? Math.round((totals.engagement / totals.impressions) * 1000) / 10 : null;
  const perDayMap = new Map<string, { day: string; posts: number; impressions: number; engagement: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    perDayMap.set(day, { day, posts: 0, impressions: 0, engagement: 0 });
  }
  for (const r of rows) {
    const d = perDayMap.get(r.published_at.slice(0, 10));
    if (!d) continue;
    d.posts += 1;
    d.impressions += n(r.impressions);
    d.engagement += n(r.engagement);
  }
  const accName = new Map(accounts.map((a) => [a.id, a]));
  return {
    days,
    from,
    totals,
    accounts: accounts.map((a) => {
      const own = stats.filter((s) => s.account_id === a.id && s.followers != null);
      const first = own[0]?.followers ?? null;
      const last = own[own.length - 1]?.followers ?? a.followers ?? null;
      const mine = rows.filter((r) => r.account_id === a.id);
      const network = a.network as SocialNetwork;
      return {
        id: a.id,
        name: a.name,
        network,
        networkName: NETWORK_SPECS[network]?.name ?? a.network,
        followers: last,
        followersDelta: first != null && last != null && own.length > 1 ? last - first : null,
        posts: mine.length,
        impressions: mine.reduce((s, r) => s + n(r.impressions), 0),
        engagement: mine.reduce((s, r) => s + n(r.engagement), 0),
      };
    }),
    perDay: [...perDayMap.values()],
    posts: rows.map((r) => {
      const a = accName.get(r.account_id)!;
      return {
        postId: r.post_id,
        targetId: r.id,
        text: r.text,
        account: a.name,
        network: a.network as SocialNetwork,
        publishedAt: r.published_at,
        url: r.external_url,
        impressions: r.impressions,
        reach: r.reach,
        engagement: r.engagement,
        likes: r.likes,
        comments: r.comments,
        shares: r.shares,
        clicks: r.clicks,
      };
    }),
    updatedAt: rows.map((r) => r.metrics_at ?? '').sort().pop() || null,
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Fórmulas de planilla neutralizadas (=, +, -, @ al principio).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function analyticsCsv(report: AnalyticsReport): string {
  const head = ['published_at', 'network', 'account', 'text', 'url', 'impressions', 'reach', 'engagement', 'likes', 'comments', 'shares', 'clicks'];
  const lines = [head.join(',')];
  for (const p of report.posts) {
    lines.push(
      [p.publishedAt, p.network, p.account, p.text.replace(/\s+/g, ' ').slice(0, 500), p.url, p.impressions, p.reach, p.engagement, p.likes, p.comments, p.shares, p.clicks].map(csvCell).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Mejores horarios para publicar en una cuenta (o en todas las que ve), en la zona `tz`. */
export async function socialBestTimes(actor: SocialActor, accountId: string | null, tz: string): Promise<{ source: 'data' | 'default'; times: BestTime[]; samples: number }> {
  const ids = await visibleAccountIds(actor);
  const scope = accountId ? ids.filter((i) => i === accountId) : ids;
  if (accountId && !scope.length) throw new SocialError(404, 'not_found');
  if (!scope.length) return bestTimes([], tz);
  const rows = (await db()
    .prepare(
      `SELECT published_at, engagement, impressions FROM social_post_targets
       WHERE account_id IN (${scope.map(() => '?').join(',')}) AND status = 'published' AND metrics_at IS NOT NULL AND published_at >= ?`,
    )
    .all(...scope, new Date(Date.now() - 180 * 86_400_000).toISOString())) as Array<{ published_at: string; engagement: number | null; impressions: number | null }>;
  return bestTimes(
    rows.map((r) => ({ publishedAt: r.published_at, engagement: n(r.engagement), impressions: n(r.impressions) })),
    tz,
  );
}
