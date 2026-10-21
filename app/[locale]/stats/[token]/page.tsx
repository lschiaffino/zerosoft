import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getPublicShare } from '@/lib/link-shares';
import { getWorkspaceAnalytics, parseTimezone, parseWorkspaceRange } from '@/lib/link-analytics';
import { breakdownLabelers } from '@/lib/link-labels';
import { formatNumber } from '@/lib/utils';
import LinkChart from '@/components/link/LinkChart';
import BreakdownBars from '@/components/link/BreakdownBars';
import '@/styles/link.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const RANGES = [7, 30, 90] as const;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, token } = await props.params;
  const t = await getTranslations({ locale, namespace: 'link' });
  const share = await getPublicShare(token);
  return {
    title: share ? t('share.publicTitle', { label: share.label }) : t('share.notFound'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Página pública de solo lectura con las analytics de un link o un tag
 * (/stats/<token>). Solo agregados: sin click log, sin IPs y con el dominio
 * del referrer, nunca la URL completa. De un tag se listan las URLs cortas,
 * no los destinos.
 */
export default async function PublicLinkStatsPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const sp = await props.searchParams;
  const share = await getPublicShare(token);
  if (!share) notFound();
  const t = await getTranslations({ locale, namespace: 'link' });

  const days = RANGES.find((d) => String(d) === sp.range) ?? 30;
  const tz = parseTimezone(typeof sp.tz === 'string' ? sp.tz : undefined);
  const today = new Date().toISOString().slice(0, 10);
  const range = parseWorkspaceRange(shift(today, -(days - 1)), today);
  const a = await getWorkspaceAnalytics(share.share.user_id, range, {
    filters: share.link ? { link: share.link.id } : { tag: share.share.tag ?? undefined },
    timezone: tz,
  });

  const labels = breakdownLabelers(locale, {
    direct: t('common.direct'),
    other: t('common.other'),
    unknown: t('labels.unknown'),
    variantDefault: t('detail.variantDefault'),
    device: { desktop: t('labels.desktop'), mobile: t('labels.mobile'), tablet: t('labels.tablet') },
    rule: (n) => t('labels.rule', { n }),
    ab: (v) => t('labels.ab', { v }),
    app: (os) => t('labels.app', { os }),
  });
  const noData = t('analytics.noData');

  return (
    <main className="lk-public" data-testid="link-public-stats">
      <header className="lk-public-head">
        <div>
          <p className="label">{share.link ? t('share.kindLink') : t('share.kindTag')}</p>
          <h1 className="lk-h data">{share.label}</h1>
          {share.link?.title && <p className="ui-help">{share.link.title}</p>}
        </div>
        <div className="btn-group lk-range" role="group" aria-label={t('detail.rangeLabel')}>
          {RANGES.map((d) => (
            <Link
              key={d}
              href={{ pathname: `/stats/${token}`, query: { range: String(d), ...(tz !== 'UTC' ? { tz } : {}) } }}
              className="btn btn-sm"
              aria-current={d === days ? 'true' : undefined}
            >
              {t(`analytics.last${d}`)}
            </Link>
          ))}
        </div>
      </header>

      <dl className="lk-stats lk-stats-2">
        <div className="lk-stat">
          <dt>{t('analytics.clicks')}</dt>
          <dd className="data num">{formatNumber(a.clicks, locale)}</dd>
        </div>
        <div className="lk-stat">
          <dt>{t('analytics.scans')}</dt>
          <dd className="data num">{formatNumber(a.scans, locale)}</dd>
        </div>
      </dl>

      <section className="lk-block" aria-labelledby="ps-chart">
        <div className="lk-panel-head">
          <h2 className="lk-h" id="ps-chart">
            {t('share.chartLabel', { tz })}
          </h2>
          <ul className="lk-legend">
            <li className="lk-key lk-key-1">{t('analytics.legendClicks')}</li>
            <li className="lk-key lk-key-2">{t('analytics.legendScans')}</li>
          </ul>
        </div>
        <LinkChart
          data={a.byDay.map((d) => ({ date: d.date, count: d.clicks }))}
          secondary={a.byDay.map((d) => ({ date: d.date, count: d.scans }))}
        />
      </section>

      {!share.link && a.topLinks.length > 0 && (
        <section className="lk-block" aria-labelledby="ps-top">
          <h2 className="lk-h" id="ps-top">
            {t('analytics.topLinks')}
          </h2>
          <BreakdownBars
            items={a.topLinks.map((l) => ({ name: l.short_url.replace(/^https?:\/\//, ''), count: l.clicks + l.scans }))}
            emptyLabel={noData}
          />
        </section>
      )}

      <div className="lk-grid-2">
        {(
          [
            ['referrers', a.referrers, labels.plain],
            ['countries', a.countries, labels.country],
            ['devices', a.devices, labels.device],
            ['browsers', a.browsers, labels.plain],
          ] as const
        ).map(([key, items, labelFor]) => (
          <section key={key} className="lk-block" aria-labelledby={`ps-${key}`}>
            <h2 className="lk-h" id={`ps-${key}`}>
              {t(`analytics.${key}`)}
            </h2>
            <BreakdownBars items={items} emptyLabel={noData} labelFor={labelFor} />
          </section>
        ))}
      </div>

      <p className="lk-public-foot">{t('share.footer')}</p>
    </main>
  );
}
