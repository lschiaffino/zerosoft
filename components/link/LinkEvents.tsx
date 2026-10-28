'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { LinkEvent, LinkEventsCursor, LinkEventsPage } from '@/lib/link-events';
import { parseDbUtc } from '@/lib/utils';

const POLL_MS = 3000;
const MAX_ROWS = 300;

function money(amount: number, currency: string, locale: string): string {
  const zero = ['JPY', 'KRW', 'CLP', 'VND', 'PYG', 'UGX', 'XAF', 'XOF'].includes(currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(zero ? amount : amount / 100);
  } catch {
    return `${amount / 100} ${currency}`;
  }
}

/**
 * Eventos en vivo (clicks, escaneos, leads y ventas): pide lo nuevo cada 3 s
 * mientras la pestaña está visible y no está en pausa. Lo recién llegado se
 * marca un momento. Sin recargar la página.
 */
export default function LinkEvents({ linkId, links = [] }: { linkId?: string; links?: Array<{ id: string; label: string }> }) {
  const t = useTranslations('link');
  const locale = useLocale();
  const router = useRouter();
  const [events, setEvents] = useState<LinkEvent[] | null>(null);
  const [older, setOlder] = useState<LinkEventsCursor | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(false);
  const cursor = useRef<LinkEventsCursor | null>(null);
  const busy = useRef(false);

  const base = linkId ? `/api/links/events?link=${encodeURIComponent(linkId)}` : '/api/links/events?';

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const c = cursor.current;
      const url = c ? `${base}${base.endsWith('?') ? '' : '&'}click=${c.click}&conv=${c.conv}` : base;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as LinkEventsPage;
      cursor.current = page.cursor;
      setError(false);
      if (!c) {
        setEvents(page.events);
        setOlder(page.older);
      } else if (page.events.length) {
        setEvents((prev) => [...page.events, ...(prev ?? [])].slice(0, MAX_ROWS));
        setFresh(new Set(page.events.map((e) => e.key)));
      }
    } catch {
      setError(true);
      setEvents((prev) => prev ?? []);
    } finally {
      busy.current = false;
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    const res = await fetch(`${base}${base.endsWith('?') ? '' : '&'}beforeClick=${older.click}&beforeConv=${older.conv}`, { cache: 'no-store' }).catch(
      () => null,
    );
    setLoadingOlder(false);
    const page = res?.ok ? ((await res.json().catch(() => null)) as LinkEventsPage | null) : null;
    if (!page) return setError(true);
    setEvents((prev) => {
      const seen = new Set((prev ?? []).map((e) => e.key));
      return [...(prev ?? []), ...page.events.filter((e) => !seen.has(e.key))];
    });
    setOlder(page.older);
  }

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [paused, load]);

  useEffect(() => {
    if (fresh.size === 0) return;
    const id = setTimeout(() => setFresh(new Set()), 2500);
    return () => clearTimeout(id);
  }, [fresh]);

  const typeLabel = (e: LinkEvent) => t(`events.type.${e.type}`);
  const time = (iso: string) => {
    const d = parseDbUtc(iso);
    const today = new Date().toDateString() === d.toDateString();
    return new Intl.DateTimeFormat(
      locale,
      today ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    ).format(d);
  };
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    regions = null;
  }
  const country = (c: string | null) => (c && /^[A-Z]{2}$/.test(c) ? (regions?.of(c) ?? c) : '—');

  return (
    <section className="lk-block lk-events" aria-labelledby="lk-events-title" data-testid="link-events">
      <div className="lk-panel-head">
        <h2 className="lk-h" id="lk-events-title">
          {t('events.title')}
        </h2>
        <div className="lk-events-actions">
          {links.length > 0 && (
            <select
              className="select lk-select-auto"
              aria-label={t('events.filterLink')}
              value={linkId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                router.push(v ? `/app/links/analytics?view=events&link=${encodeURIComponent(v)}` : '/app/links/analytics?view=events');
              }}
            >
              <option value="">{t('events.allLinks')}</option>
              {links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
          <span className={`lk-live${paused ? ' is-paused' : ''}`} role="status" aria-live="polite">
            <span className="lk-live-dot" aria-hidden="true" />
            {paused ? t('events.paused') : t('events.live')}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? t('events.resume') : t('events.pause')}
          </button>
        </div>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('events.error')}
        </p>
      )}
      {events === null ? (
        <div className="lk-events-loading" aria-busy="true" aria-label={t('events.loading')}>
          <span className="ui-skeleton" />
          <span className="ui-skeleton" />
          <span className="ui-skeleton" />
        </div>
      ) : events.length === 0 ? (
        <p className="lk-empty-line">{t('events.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact lk-events-table">
            <caption className="sr-only">{t('events.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('events.colTime')}</th>
                <th scope="col">{t('events.colEvent')}</th>
                <th scope="col">{t('events.colLink')}</th>
                <th scope="col">{t('detail.colCountry')}</th>
                <th scope="col" className="lk-col-hide-sm">
                  {t('detail.colDevice')}
                </th>
                <th scope="col" className="lk-col-hide-sm">
                  {t('events.colDetail')}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.key} className={fresh.has(e.key) ? 'lk-event-new' : undefined} data-type={e.type}>
                  <td className="data lk-ev-time" title={parseDbUtc(e.ts).toLocaleString(locale)}>
                    {time(e.ts)}
                  </td>
                  <td>
                    <span className={`badge lk-ev-${e.type}`}>{typeLabel(e)}</span>
                  </td>
                  <td className="data lk-cell-trunc">
                    <Link href={`/app/links/${e.linkId}`} className="cell-link">
                      {e.shortUrl.replace(/^https?:\/\//, '')}
                    </Link>
                  </td>
                  <td>{country(e.country)}</td>
                  <td className="lk-col-hide-sm">{e.device ? t(`labels.${e.device}`) : '—'}</td>
                  <td className="lk-col-hide-sm lk-cell-trunc">
                    {e.type === 'sale' && e.amount !== null && e.currency
                      ? `${e.eventName ?? ''} · ${money(e.amount, e.currency, locale)}`
                      : e.type === 'lead'
                        ? (e.eventName ?? '')
                        : (e.referrer ?? t('common.direct'))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events && events.length > 0 && older && (
        <p>
          <button type="button" className="btn btn-sm" onClick={() => void loadOlder()} disabled={loadingOlder} aria-busy={loadingOlder || undefined}>
            {t('events.loadOlder')}
          </button>
        </p>
      )}
    </section>
  );
}
