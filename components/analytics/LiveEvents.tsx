'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { LiveEvent } from '@/lib/analytics/types';
import { api, fmtTime } from './client';
import { EventInput, useProjectMeta } from './Filters';

const POLL_MS = 3000;

/**
 * Eventos en vivo (la pestaña Activity de PostHog): los últimos 100 y, cada
 * 3 s, lo nuevo arriba. Pausa, filtro por evento y detalle de propiedades.
 */
export default function LiveEvents({ projectId, initial }: { projectId: string; initial: LiveEvent[] }) {
  const t = useTranslations('analytics.events');
  const locale = useLocale();
  const meta = useProjectMeta(projectId);
  const [events, setEvents] = useState<LiveEvent[]>(initial);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [older, setOlder] = useState(initial.length >= 100);
  const latest = useRef(initial[0]?.id ?? 0);
  const applied = useRef('');

  const q = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ project: projectId, ...params });
    if (applied.current && applied.current !== '*') sp.set('event', applied.current);
    return `/api/analytics/events?${sp}`;
  };

  const reload = useCallback(async () => {
    try {
      const { events: rows } = await api<{ events: LiveEvent[] }>(q({}));
      setEvents(rows);
      latest.current = rows[0]?.id ?? 0;
      setOlder(rows.length >= 100);
      setError(false);
    } catch {
      setError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (paused) return;
    const tick = async () => {
      try {
        const { events: rows } = await api<{ events: LiveEvent[] }>(q({ after: String(latest.current) }));
        if (rows.length) {
          latest.current = rows[0].id;
          setEvents((prev) => [...rows, ...prev].slice(0, 500));
        }
        setError(false);
      } catch {
        setError(true);
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, projectId]);

  const loadOlder = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    const { events: rows } = await api<{ events: LiveEvent[] }>(q({ before: String(last.id) }));
    setEvents((prev) => [...prev, ...rows]);
    setOlder(rows.length >= 100);
  };

  return (
    <div className="an-live">
      <form
        className="an-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          applied.current = filter.trim();
          void reload();
        }}
      >
        <EventInput value={filter} onChange={setFilter} meta={meta} label={t('filter')} />
        <button type="submit" className="btn btn-sm">
          {t('apply')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? t('resume') : t('pause')}
        </button>
        <span className="an-live-status" role="status">
          {paused ? t('paused') : t('live')}
        </span>
      </form>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {events.length === 0 ? (
        <div className="an-callout" data-testid="an-live-empty">
          <p>{t('empty')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact an-table an-live-table" data-testid="an-live-table">
            <thead>
              <tr>
                <th scope="col">{t('event')}</th>
                <th scope="col">{t('person')}</th>
                <th scope="col" className="an-hide-sm">
                  {t('url')}
                </th>
                <th scope="col">{t('time')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td>
                      <button type="button" className="an-row-button" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {e.event}
                      </button>
                    </td>
                    <td className="an-mono an-ellipsis">{e.distinctId}</td>
                    <td className="an-hide-sm an-ellipsis">{e.pathname ?? e.url ?? ''}</td>
                    <td className="an-muted an-nowrap">{fmtTime(e.ts, locale)}</td>
                  </tr>
                  {open === e.id && (
                    <tr className="an-live-detail">
                      <td colSpan={4}>
                        <dl className="an-props">
                          {[
                            ['$browser', e.browser],
                            ['$os', e.os],
                            ['$device_type', e.device],
                            ['$geoip_country_code', e.country],
                            ...Object.entries(e.properties).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as const),
                          ]
                            .filter(([, v]) => v !== null && v !== undefined && v !== '')
                            .map(([k, v]) => (
                              <Fragment key={k}>
                                <dt>{k}</dt>
                                <dd>{String(v)}</dd>
                              </Fragment>
                            ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {older && events.length > 0 && (
        <button type="button" className="btn btn-sm" onClick={() => void loadOlder()}>
          {t('older')}
        </button>
      )}
    </div>
  );
}
