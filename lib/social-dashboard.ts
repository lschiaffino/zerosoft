/**
 * Social, analítica con el kit (el formato de Lines): publicaciones,
 * impresiones, alcance, interacción y clics de las cuentas que la persona ve,
 * en un período contra el anterior (días y horas en la zona de quien mira).
 * Las métricas de cada publicación las trae el cron cada hora
 * (lib/social-cron.ts); acá solo se agregan.
 */
import { getDb } from './db';
import { SocialError, visibleAccountRows, type SocialActor } from './social';
import { NETWORK_SPECS, type SocialNetwork } from './social-networks';
import { analyticsRange, daySeries, localDay, rangeInfo, sumOf, tzOffsetSec, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export interface SocialDay {
  day: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number;
  clicks: number;
}

export interface SocialTargetRow {
  id: string;
  post_id: string;
  account_id: string;
  published_at: string;
  impressions: number | null;
  reach: number | null;
  engagement: number | null;
  clicks: number | null;
  metrics_at: string | null;
  text: string;
}

export interface SocialAccountInfo {
  id: string;
  name: string;
  network: string;
  followers: number | null;
}

export interface SocialDashboard {
  range: RangeInfo;
  kpis: { posts: Kpi; impressions: Kpi; reach: Kpi; engagement: Kpi; clicks: Kpi; engagementRate: Kpi; followers: Kpi };
  perDay: SocialDay[];
  accounts: Array<{ id: string; name: string; network: SocialNetwork; networkName: string; followers: number | null; followersDelta: number | null; posts: number; impressions: number; engagement: number }>;
  networks: Array<{ network: SocialNetwork; name: string; posts: number; engagement: number; impressions: number }>;
  topPosts: Array<{ postId: string; targetId: string; text: string; account: string; network: SocialNetwork; impressions: number | null; engagement: number | null; clicks: number | null }>;
  /** Interacción por día de la semana (0 = lunes) y hora local de publicación. */
  heat: number[][];
  /** Cuántas cuentas ve la persona (sin cuentas, el vacío invita a conectar una). */
  accountCount: number;
  updatedAt: string | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Agrega las filas leídas (puro: lo prueban los tests). */
export function aggregateSocial(
  q: ReturnType<typeof analyticsRange>,
  rows: SocialTargetRow[],
  accounts: SocialAccountInfo[],
  stats: Array<{ account_id: string; day: string; followers: number | null }>,
): SocialDashboard {
  const since = Date.parse(q.since);
  const empty = (): Omit<SocialDay, 'day'> => ({ posts: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0 });
  const byDay = new Map<string, Omit<SocialDay, 'day'>>();
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cur: SocialTargetRow[] = [];
  for (const r of rows) {
    const ms = Date.parse(r.published_at);
    if (!Number.isFinite(ms)) continue;
    const day = localDay(ms, q.tz);
    let v = byDay.get(day);
    if (!v) byDay.set(day, (v = empty()));
    v.posts += 1;
    v.impressions += n(r.impressions);
    v.reach += n(r.reach);
    v.engagement += n(r.engagement);
    v.clicks += n(r.clicks);
    if (ms >= since) {
      cur.push(r);
      const local = new Date(ms + tzOffsetSec(ms, q.tz) * 1000);
      heat[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += n(r.engagement);
    }
  }
  const { cur: perDay, prev } = daySeries(q, byDay, empty);
  const total = (list: SocialDay[], k: keyof Omit<SocialDay, 'day'>) => sumOf(list, (p) => p[k]);
  const rate = (list: SocialDay[]) => (total(list, 'impressions') > 0 ? total(list, 'engagement') / total(list, 'impressions') : null);

  // Seguidores: el último dato del período contra el último antes de empezar.
  const followersAt = (accountId: string, before: string | null) => {
    const own = stats.filter((s) => s.account_id === accountId && s.followers != null && (before == null || s.day < before));
    return own.length ? n(own[own.length - 1].followers) : null;
  };
  const accInfo = new Map(accounts.map((a) => [a.id, a]));
  const accountsOut = accounts.map((a) => {
    const network = a.network as SocialNetwork;
    const mine = cur.filter((r) => r.account_id === a.id);
    const last = followersAt(a.id, null) ?? a.followers ?? null;
    const first = followersAt(a.id, q.from);
    return {
      id: a.id,
      name: a.name,
      network,
      networkName: NETWORK_SPECS[network]?.name ?? a.network,
      followers: last,
      followersDelta: first != null && last != null ? last - first : null,
      posts: mine.length,
      impressions: sumOf(mine, (r) => n(r.impressions)),
      engagement: sumOf(mine, (r) => n(r.engagement)),
    };
  });
  const followersNow = accountsOut.some((a) => a.followers != null) ? sumOf(accountsOut, (a) => a.followers ?? 0) : null;
  const followersBefore = accounts.some((a) => followersAt(a.id, q.from) != null) ? sumOf(accounts, (a) => followersAt(a.id, q.from) ?? 0) : null;

  const networks = new Map<SocialNetwork, { network: SocialNetwork; name: string; posts: number; engagement: number; impressions: number }>();
  for (const a of accountsOut) {
    const x = networks.get(a.network) ?? { network: a.network, name: a.networkName, posts: 0, engagement: 0, impressions: 0 };
    x.posts += a.posts;
    x.engagement += a.engagement;
    x.impressions += a.impressions;
    networks.set(a.network, x);
  }

  return {
    range: rangeInfo(q),
    kpis: {
      posts: { value: total(perDay, 'posts'), prev: total(prev, 'posts') },
      impressions: { value: total(perDay, 'impressions'), prev: total(prev, 'impressions') },
      reach: { value: total(perDay, 'reach'), prev: total(prev, 'reach') },
      engagement: { value: total(perDay, 'engagement'), prev: total(prev, 'engagement') },
      clicks: { value: total(perDay, 'clicks'), prev: total(prev, 'clicks') },
      engagementRate: { value: rate(perDay), prev: rate(prev) },
      followers: { value: followersNow, prev: followersBefore },
    },
    perDay,
    accounts: accountsOut.sort((a, b) => b.engagement - a.engagement || b.posts - a.posts || a.name.localeCompare(b.name)),
    networks: [...networks.values()].filter((x) => x.posts > 0).sort((a, b) => b.engagement - a.engagement || b.posts - a.posts),
    topPosts: [...cur]
      .sort((a, b) => n(b.engagement) - n(a.engagement) || n(b.impressions) - n(a.impressions))
      .slice(0, 25)
      .map((r) => {
        const a = accInfo.get(r.account_id);
        return {
          postId: r.post_id,
          targetId: r.id,
          text: r.text,
          account: a?.name ?? '',
          network: (a?.network ?? '') as SocialNetwork,
          impressions: r.impressions,
          engagement: r.engagement,
          clicks: r.clicks,
        };
      }),
    heat,
    accountCount: accounts.length,
    updatedAt: cur.map((r) => r.metrics_at ?? '').sort().pop() || null,
  };
}

/** La analítica de Social de las cuentas que ve la persona (o de una, si la ve). */
export async function socialDashboard(actor: SocialActor, accountId: string | undefined, query: RangeInput = {}, now = new Date()): Promise<SocialDashboard> {
  const q = analyticsRange(query, now);
  let accounts = (await visibleAccountRows(actor)) as unknown as SocialAccountInfo[];
  if (accountId) {
    accounts = accounts.filter((a) => a.id === accountId);
    if (!accounts.length) throw new SocialError(404, 'not_found');
  }
  if (!accounts.length) return aggregateSocial(q, [], [], []);
  const ids = accounts.map((a) => a.id);
  const marks = ids.map(() => '?').join(',');
  const db = getDb();
  const [rows, stats] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.post_id, t.account_id, t.published_at, t.impressions, t.reach, t.engagement, t.clicks, t.metrics_at,
                COALESCE(NULLIF(t.text_override, ''), p.text) AS text
         FROM social_post_targets t JOIN social_posts p ON p.id = t.post_id
         WHERE t.account_id IN (${marks}) AND t.status = 'published' AND t.published_at >= ? AND t.published_at < ?`,
      )
      .all(...ids, q.prevSince, q.until) as Promise<SocialTargetRow[]>,
    db
      .prepare(`SELECT account_id, day, followers FROM social_account_stats WHERE account_id IN (${marks}) AND day >= ? AND day <= ? ORDER BY day`)
      .all(...ids, q.prevFrom, q.to) as Promise<Array<{ account_id: string; day: string; followers: number | null }>>,
  ]);
  return aggregateSocial(q, rows, accounts, stats);
}

export function isSocialDashboardEmpty(d: SocialDashboard): boolean {
  return d.accountCount === 0 || (!d.kpis.posts.value && !d.kpis.posts.prev);
}

const cache = shortCache<SocialDashboard>();

/** Con la caché corta del kit. La clave lleva quién mira (ve otras cuentas), la cuenta y el rango. */
export function cachedSocialDashboard(actor: SocialActor, viewerId: string, accountId: string | undefined, query: RangeInput = {}): Promise<SocialDashboard> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([viewerId, actor, accountId ?? '', r.since, r.until, r.tz]), () => socialDashboard(actor, accountId, query, now));
}

export function clearSocialDashboardCache(): void {
  cache.clear();
}
