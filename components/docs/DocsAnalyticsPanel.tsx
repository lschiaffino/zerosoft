'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import DocsViewsChart, { type ViewsDay } from './DocsViewsChart';

interface PageAnalytics {
  days: number;
  views: number;
  viewers: number;
  series: ViewsDay[];
  people: Array<{ id: string; name: string | null; views: number; last_at: string }>;
  site: { views: number; visitors: number } | null;
}

/** "Analítica" de la página (como Updates & analytics de Notion): vistas, personas y quién la vio. */
export default function DocsAnalyticsPanel({ pageId }: { pageId: string }) {
  const t = useTranslations('docs.analytics');
  const format = useFormatter();
  const [data, setData] = useState<PageAnalytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    fetch(`/api/docs/pages/${encodeURIComponent(pageId)}/views?days=30`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as PageAnalytics;
      })
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [pageId]);

  return (
    <section className="docs-analytics" aria-labelledby="docs-analytics-title" data-testid="docs-analytics">
      <h2 className="docs-side-title" id="docs-analytics-title">
        {t('title')}
      </h2>
      {error ? (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      ) : !data ? (
        <p className="ui-help" role="status">
          {t('loading')}
        </p>
      ) : (
        <>
          <dl className="docs-analytics-stats">
            <div>
              <dt>{t('views')}</dt>
              <dd data-testid="docs-analytics-views">{data.views}</dd>
            </div>
            <div>
              <dt>{t('viewers')}</dt>
              <dd>{data.viewers}</dd>
            </div>
            {data.site && (
              <div>
                <dt>{t('siteViews')}</dt>
                <dd>{data.site.views}</dd>
              </div>
            )}
          </dl>
          <p className="ui-help">{t('period', { days: data.days })}</p>
          <DocsViewsChart series={data.series} label={t('chart')} />
          <h3 className="docs-analytics-h">{t('who')}</h3>
          {data.people.length === 0 ? (
            <p className="ui-help">{t('nobody')}</p>
          ) : (
            <ul className="docs-analytics-people">
              {data.people.map((p) => (
                <li key={p.id}>
                  <span className="docs-analytics-name">{p.name || t('someone')}</span>
                  <span className="ui-help">
                    {format.relativeTime(new Date(p.last_at), new Date())} · {t('viewCount', { count: p.views })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
