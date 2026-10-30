import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { requireUser } from '@/lib/session';
import { socialActor, SocialError, visibleAccountRows } from '@/lib/social';
import { socialAnalytics, socialBestTimes } from '@/lib/social-analytics';
import { getUserTimeZone } from '@/lib/user-tz';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'social' });
  return { title: t('analytics.title') };
}

/** Métricas: totales, por día, por cuenta y por publicación, con CSV y mejores horarios. */
export default async function SocialAnalyticsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ days?: string; account?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'social' });
  const actor = socialActor(user);
  const tz = await getUserTimeZone();
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const report = await socialAnalytics(actor, { days, accountId: sp.account || undefined }).catch((err) => {
    if (err instanceof SocialError) return socialAnalytics(actor, { days });
    throw err;
  });
  const best = await socialBestTimes(actor, sp.account || null, tz).catch(() => null);
  const allAccounts = await visibleAccountRows(actor);
  const num = (n: number | null | undefined) => (n == null ? '·' : new Intl.NumberFormat(locale).format(n));
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ days: String(days), ...(sp.account ? { account: sp.account } : {}), ...extra });
    return `/app/social/analytics?${q.toString()}`;
  };
  const csv = `/api/social/analytics?${new URLSearchParams({ days: String(days), format: 'csv', ...(sp.account ? { account: sp.account } : {}) }).toString()}`;
  const max = Math.max(1, ...report.perDay.map((d) => d.engagement));
  const weekday = (d: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));

  return (
    <div className="ui-page">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.description')}
        actions={
          <a className="btn" href={csv} download data-testid="analytics-csv">
            {t('analytics.export')}
          </a>
        }
      />
      <div className="sc-page">
        <div className="sc-row">
          <nav className="ui-tabs sc-grow" aria-label={t('analytics.period')}>
            {[7, 30, 90].map((d) => (
              <Link key={d} className="ui-tab" href={keep({ days: String(d) })} aria-current={d === days ? 'page' : undefined}>
                {t('analytics.days', { n: d })}
              </Link>
            ))}
          </nav>
          <nav className="ui-tabs" aria-label={t('analytics.account')}>
            <Link className="ui-tab" href={`/app/social/analytics?days=${days}`} aria-current={!sp.account ? 'page' : undefined}>
              {t('analytics.allAccounts')}
            </Link>
            {(allAccounts.length > 1 || sp.account) &&
              allAccounts.map((a) => (
                <Link key={a.id} className="ui-tab" href={`/app/social/analytics?days=${days}&account=${a.id}`} aria-current={sp.account === a.id ? 'page' : undefined}>
                  {a.name}
                </Link>
              ))}
          </nav>
        </div>

        {report.accounts.length === 0 ? (
          <EmptyState title={t('analytics.emptyTitle')} body={t('analytics.emptyBody')} product="social" action={{ label: t('calendar.emptyAction'), href: '/app/social/accounts' }} />
        ) : (
          <>
            <div className="sc-tiles" data-testid="analytics-totals">
              {(
                [
                  ['posts', report.totals.posts],
                  ['impressions', report.totals.impressions],
                  ['reach', report.totals.reach],
                  ['engagement', report.totals.engagement],
                  ['clicks', report.totals.clicks],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="sc-tile">
                  <span className="sc-tile-value" data-testid={`total-${k}`}>
                    {num(v)}
                  </span>
                  <span className="sc-tile-label">{t(`analytics.${k}`)}</span>
                </div>
              ))}
              <div className="sc-tile">
                <span className="sc-tile-value">{report.totals.engagementRate == null ? '·' : `${report.totals.engagementRate}%`}</span>
                <span className="sc-tile-label">{t('analytics.engagementRate')}</span>
              </div>
            </div>
            <p className="sc-muted sc-small">
              {report.updatedAt
                ? t('analytics.updated', { when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(report.updatedAt)) })
                : t('analytics.notYet')}
            </p>

            <section className="sc-panel" aria-labelledby="sc-an-days">
              <h2 id="sc-an-days">{t('analytics.engagementPerDay')}</h2>
              <div className="sc-bars" role="img" aria-label={t('analytics.engagementPerDay')}>
                {report.perDay.map((d) => (
                  <span key={d.day} className="sc-bar" data-zero={d.engagement === 0} style={d.engagement ? { height: `${Math.max(2, (d.engagement / max) * 100)}%` } : undefined} title={`${d.day}: ${d.engagement}`} />
                ))}
              </div>
            </section>

            <section className="sc-panel" aria-labelledby="sc-an-acc">
              <h2 id="sc-an-acc">{t('analytics.byAccount')}</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('analytics.accountCol')}</th>
                      <th className="num">{t('analytics.followers')}</th>
                      <th className="num">{t('analytics.posts')}</th>
                      <th className="num">{t('analytics.impressions')}</th>
                      <th className="num">{t('analytics.engagement')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <span className="sc-net" data-net={a.network}>
                            {a.name}
                          </span>
                        </td>
                        <td className="num">
                          {num(a.followers)}
                          {a.followersDelta != null && a.followersDelta !== 0 && <span className="sc-muted"> ({a.followersDelta > 0 ? '+' : ''}{num(a.followersDelta)})</span>}
                        </td>
                        <td className="num">{num(a.posts)}</td>
                        <td className="num">{num(a.impressions)}</td>
                        <td className="num">{num(a.engagement)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="sc-panel" aria-labelledby="sc-an-posts">
              <h2 id="sc-an-posts">{t('analytics.byPost')}</h2>
              {report.posts.length === 0 ? (
                <p className="sc-muted">{t('analytics.noPosts')}</p>
              ) : (
                <div className="table-wrap">
                  <table className="table" data-testid="analytics-posts">
                    <thead>
                      <tr>
                        <th>{t('analytics.postCol')}</th>
                        <th className="num">{t('analytics.impressions')}</th>
                        <th className="num">{t('analytics.engagement')}</th>
                        <th className="num">{t('analytics.clicks')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...report.posts]
                        .sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0))
                        .slice(0, 50)
                        .map((p) => (
                          <tr key={p.targetId}>
                            <td>
                              <Link href={`/app/social/posts/${p.postId}`}>{p.text.replace(/\s+/g, ' ').slice(0, 80) || t('calendar.mediaOnly')}</Link>
                              <div className="sc-net sc-small" data-net={p.network}>
                                {p.account}
                              </div>
                            </td>
                            <td className="num">{num(p.impressions)}</td>
                            <td className="num">{num(p.engagement)}</td>
                            <td className="num">{num(p.clicks)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {best && (
              <section className="sc-panel" aria-labelledby="sc-an-best">
                <h2 id="sc-an-best">{t('analytics.bestTimes')}</h2>
                <p className="sc-muted sc-small">{best.source === 'data' ? t('compose.bestFromData', { n: best.samples }) : t('compose.bestDefault')}</p>
                <div className="sc-best">
                  {best.times.map((b) => (
                    <span key={`${b.weekday}-${b.hour}`} className="sc-tag">
                      {weekday(b.weekday)} {String(b.hour).padStart(2, '0')}:00{b.score != null ? ` · ${b.score}` : ''}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
