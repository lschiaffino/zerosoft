'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { LinkDto, VersionDto } from '@/lib/send/core';
import type { DocumentAnalytics, VisitDto } from '@/lib/send/analytics';
import { formatSeconds, useDate } from './ui';

/** Etiqueta de un tramo: "Página 3" o, en un video, "0:20–0:30". */
function usePartLabel(kind: string, bucketSec: number | null) {
  const t = useTranslations('send.visits');
  return (page: number) => {
    if (kind === 'video' && bucketSec) {
      const from = (page - 1) * bucketSec;
      return `${clock(from)}–${clock(from + bucketSec)}`;
    }
    return t('page', { page });
  };
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function AnalyticsPanels({
  mode,
  analytics,
  error,
  onRetry,
  versions,
  links,
  filter,
  setFilter,
  exportUrl,
  kind,
  bucketSec,
}: {
  mode: 'activity' | 'pages';
  analytics: DocumentAnalytics | null;
  error: boolean;
  onRetry: () => void;
  versions: VersionDto[];
  links: LinkDto[];
  filter: { version: string; link: string };
  setFilter: (f: { version: string; link: string }) => void;
  exportUrl: string | null;
  currentVersionId: string | null;
  kind: string;
  bucketSec: number | null;
}) {
  const t = useTranslations('send.visits');
  const tv = useTranslations('send.versions');
  const tc = useTranslations('send.common');
  if (error && !analytics) {
    return (
      <div className="sd-notice sd-notice-bad" role="alert">
        {t('loadError')}{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          {tc('retry')}
        </button>
      </div>
    );
  }
  if (!analytics) {
    return (
      <div className="ui-loading-stack" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="ui-skeleton ui-skeleton-row" />
        ))}
      </div>
    );
  }
  const a = analytics;
  return (
    <section data-testid={`send-${mode}`}>
      <div className="sd-filters">
        <select className="input" value={filter.version} onChange={(e) => setFilter({ ...filter, version: e.target.value })} aria-label={tv('title')} data-testid="send-filter-version">
          <option value="">{t('allVersions')}</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {tv('label', { n: v.n })}
            </option>
          ))}
        </select>
        <select className="input" value={filter.link} onChange={(e) => setFilter({ ...filter, link: e.target.value })} aria-label={t('linkFilter')} data-testid="send-filter-link">
          <option value="">{t('allLinks')}</option>
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name || t('unnamedLink')}
            </option>
          ))}
        </select>
        {exportUrl && (
          <a className="btn btn-secondary btn-sm sd-push" href={exportUrl} data-testid="send-export">
            {t('export')}
          </a>
        )}
      </div>
      <div className="sd-kpis">
        <div>
          <strong className="num" data-testid="kpi-visits">
            {a.totals.visits}
          </strong>
          <span>{t('kVisits')}</span>
        </div>
        <div>
          <strong className="num" data-testid="kpi-visitors">
            {a.totals.visitors}
          </strong>
          <span>{t('kVisitors')}</span>
        </div>
        <div>
          <strong className="num" data-testid="kpi-time">
            {formatSeconds(a.totals.avgSeconds)}
          </strong>
          <span>{t('kAvgTime')}</span>
        </div>
        <div>
          <strong className="num" data-testid="kpi-completion">
            {a.totals.avgCompletion}%
          </strong>
          <span>{t('kCompletion')}</span>
        </div>
        <div>
          <strong className="num">{a.totals.downloads}</strong>
          <span>{t('kDownloads')}</span>
        </div>
      </div>
      {a.totals.visits === 0 ? <EmptyState compact body={t('empty')} /> : mode === 'activity' ? <Activity a={a} kind={kind} bucketSec={bucketSec} /> : <Pages a={a} kind={kind} bucketSec={bucketSec} />}
      <p className="sd-help">{t('howMeasured')}</p>
    </section>
  );
}

function Activity({ a, kind, bucketSec }: { a: DocumentAnalytics; kind: string; bucketSec: number | null }) {
  const t = useTranslations('send.visits');
  const date = useDate();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <h3 className="sd-h3">{t('peopleTitle')}</h3>
      <div className="table-wrap">
        <table className="table sd-table" data-testid="send-visitors">
          <thead>
            <tr>
              <th scope="col">{t('colVisitor')}</th>
              <th scope="col" className="num">
                {t('kVisits')}
              </th>
              <th scope="col" className="num">
                {t('colTime')}
              </th>
              <th scope="col" className="num">
                {t('colCompletion')}
              </th>
              <th scope="col" className="sd-hide-sm">
                {t('colLast')}
              </th>
            </tr>
          </thead>
          <tbody>
            {a.visitors.map((v) => (
              <tr key={v.key}>
                <th scope="row">
                  <span className="sd-rowtitle sd-wrap">{v.email ?? t('anonymous')}</span>
                  <span className="sd-tags">
                    {v.email && (v.verified ? <span className="badge badge-ok">{t('verified')}</span> : <span className="badge badge-outline">{t('unverified')}</span>)}
                    {v.forwarded && <span className="badge badge-warn">{t('forwarded')}</span>}
                    {v.contactId && (
                      <Link href={`/app/crm/contacts/${v.contactId}`} className="badge badge-info">
                        {t('crmContact')}
                      </Link>
                    )}
                  </span>
                </th>
                <td className="num">{v.visits}</td>
                <td className="num">{formatSeconds(v.seconds)}</td>
                <td className="num">{v.bestCompletion}%</td>
                <td className="sd-hide-sm">{date(v.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="sd-h3">{t('visitsTitle')}</h3>
      <div className="table-wrap">
        <table className="table sd-table" data-testid="send-visit-table">
          <thead>
            <tr>
              <th scope="col">{t('colVisitor')}</th>
              <th scope="col" className="num">
                {t('colTime')}
              </th>
              <th scope="col" className="num">
                {t('colCompletion')}
              </th>
              <th scope="col" className="sd-hide-sm">
                {t('colWhen')}
              </th>
            </tr>
          </thead>
          <tbody>
            {a.visits.map((v) => (
              <Fragment key={v.id}>
                <tr data-testid="send-visit-row">
                  <th scope="row">
                    <button type="button" className="sd-disclose" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)} data-testid="send-visit-open">
                      <span className="sd-rowtitle sd-wrap">{v.email ?? t('anonymous')}</span>
                      <span className="sd-rowmeta">{describe(v, t)}</span>
                    </button>
                    {v.live && (
                      <span className="sd-live">
                        <i aria-hidden="true" />
                        {t('liveNow')}
                      </span>
                    )}
                  </th>
                  <td className="num" data-testid="visit-seconds">
                    {formatSeconds(v.seconds)}
                  </td>
                  <td className="num" data-testid="visit-completion">
                    {v.completion}%
                  </td>
                  <td className="sd-hide-sm">{date(v.startedAt)}</td>
                </tr>
                {open === v.id && (
                  <tr className="sd-visit-detail">
                    <td colSpan={4}>
                      <VisitDetail v={v} kind={kind} bucketSec={bucketSec} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {a.linkClicks.length > 0 && (
        <>
          <h3 className="sd-h3">{t('clicksTitle')}</h3>
          <div className="table-wrap">
            <table className="table sd-table" data-testid="send-link-clicks">
              <thead>
                <tr>
                  <th scope="col">{t('colLink')}</th>
                  <th scope="col" className="num">
                    {t('colOnPage')}
                  </th>
                  <th scope="col" className="num">
                    {t('colClicks')}
                  </th>
                  <th scope="col" className="num sd-hide-sm">
                    {t('kVisitors')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {a.linkClicks.map((c, i) => (
                  <tr key={i}>
                    <th scope="row">
                      <span className="sd-rowtitle sd-wrap">{c.url ?? t('toPage', { page: c.toPage ?? 1 })}</span>
                    </th>
                    <td className="num">{c.page}</td>
                    <td className="num">{c.clicks}</td>
                    <td className="num sd-hide-sm">{c.people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {a.denied.length > 0 && (
        <>
          <h3 className="sd-h3">{t('deniedTitle')}</h3>
          <ul className="sd-denied" data-testid="send-denied">
            {a.denied.map((d, i) => (
              <li key={i}>
                <span className="sd-wrap">{d.email ?? t('anonymous')}</span>
                <span className="sd-rowmeta">
                  {d.linkName ? `${d.linkName} · ` : ''}
                  {date(d.at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function describe(v: VisitDto, t: ReturnType<typeof useTranslations>): string {
  const place = [v.city, v.country].filter(Boolean).join(', ');
  return [v.email ? (v.emailVerified ? t('verified') : t('unverified')) : '', v.forwarded ? t('forwarded') : '', v.returning ? t('returning') : '', v.linkName, t('versionShort', { n: v.versionN }), t(`device_${v.device || 'desktop'}`), place].filter(Boolean).join(' · ');
}

function VisitDetail({ v, kind, bucketSec }: { v: VisitDto; kind: string; bucketSec: number | null }) {
  const t = useTranslations('send.visits');
  const label = usePartLabel(kind, bucketSec);
  const max = Math.max(1, ...v.pages.map((p) => p.seconds));
  const seconds = new Map(v.pages.map((p) => [p.page, p.seconds]));
  return (
    <div data-testid="send-visit-detail">
      <ul className="sd-bars">
        {Array.from({ length: v.pageTotal }, (_, i) => i + 1).map((page) => {
          const s = seconds.get(page) ?? 0;
          return (
            <li key={page} data-page={page} data-seconds={s}>
              <span className="sd-bar-label">{label(page)}</span>
              <span className="sd-bar-track">
                <i style={{ width: `${(s / max) * 100}%` }} />
              </span>
              <span className="sd-bar-value num">{s > 0 ? formatSeconds(s) : t('notSeen')}</span>
            </li>
          );
        })}
      </ul>
      {v.clicks.length > 0 && (
        <ul className="sd-clicks" data-testid="send-visit-clicks">
          {v.clicks.map((c, i) => (
            <li key={i} className="sd-rowmeta sd-wrap">
              {t('clickedOn', { page: c.page, target: c.url ?? t('toPage', { page: c.toPage ?? 1 }) })}
            </li>
          ))}
        </ul>
      )}
      <p className="sd-rowmeta">{[v.browser, v.os].filter(Boolean).join(' · ')}</p>
      {!v.city && !v.country && <p className="sd-help">{t('noLocation')}</p>}
    </div>
  );
}

function Pages({ a, kind, bucketSec }: { a: DocumentAnalytics; kind: string; bucketSec: number | null }) {
  const t = useTranslations('send.visits');
  const label = usePartLabel(kind, bucketSec);
  const max = Math.max(1, ...a.pages.map((p) => p.avgSeconds));
  return (
    <>
      <h3 className="sd-h3">{t('perPage', { n: a.pagesVersionN })}</h3>
      <ul className="sd-bars sd-bars-pages" data-testid="send-page-stats">
        {a.pages.map((p) => (
          <li key={p.page} data-page={p.page} data-avg={p.avgSeconds} data-reach={p.reach}>
            <span className="sd-bar-label">{label(p.page)}</span>
            <span className="sd-bar-track">
              <i style={{ width: `${(p.avgSeconds / max) * 100}%` }} />
            </span>
            <span className="sd-bar-value num">{formatSeconds(p.avgSeconds)}</span>
            <span className="sd-bar-reach num">{t('reach', { pct: p.reach })}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
