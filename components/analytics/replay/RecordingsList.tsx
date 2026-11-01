'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { useMounted } from '@/components/ui/useMounted';
import type { RecordingDto } from '@/lib/analytics/replay';
import RangeSelect from '../RangeSelect';
import { api, fmtDuration, fmtTime } from '../client';

const DURATIONS = [0, 10, 60, 300];

function urlPath(raw: string | null): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`;
  } catch {
    return raw;
  }
}

/** Lista de grabaciones con filtros. Borrar saca la fila sin recargar. */
export default function RecordingsList({
  projectId,
  initial,
  initialHasMore,
  enabled,
  canManage,
}: {
  projectId: string;
  initial: RecordingDto[];
  initialHasMore: boolean;
  enabled: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('analyticsReplay.recordings');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const mounted = useMounted();
  const [rows, setRows] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [person, setPerson] = useState('');
  const [url, setUrl] = useState('');
  const [range, setRange] = useState('-30d');
  const [minSeconds, setMinSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState<RecordingDto | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef(true);
  const filtered = !!(person.trim() || url.trim() || minSeconds || range !== '-30d');

  const query = (offset: number) => {
    const sp = new URLSearchParams({ project: projectId, range, offset: String(offset) });
    if (person.trim()) sp.set('person', person.trim());
    if (url.trim()) sp.set('url', url.trim());
    if (minSeconds) sp.set('minSeconds', String(minSeconds));
    return `/api/analytics/replay?${sp}`;
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctl = new AbortController();
    const id = setTimeout(() => {
      setLoading(true);
      api<{ recordings: RecordingDto[]; hasMore: boolean }>(query(0), { signal: ctl.signal })
        .then((r) => {
          setRows(r.recordings);
          setHasMore(r.hasMore);
          setError(false);
        })
        .catch((err: unknown) => {
          if ((err as Error).name !== 'AbortError') setError(true);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, url, range, minSeconds]);

  const more = async () => {
    setLoading(true);
    try {
      const r = await api<{ recordings: RecordingDto[]; hasMore: boolean }>(query(rows.length));
      setRows((p) => [...p, ...r.recordings]);
      setHasMore(r.hasMore);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // Sin grabaciones y sin filtros: acá se explica qué falta (apagado, o prendido y sin datos todavía).
  if (rows.length === 0 && !filtered && !loading && !error) {
    if (!enabled) {
      return (
        <EmptyState
          product="analytics"
          title={t('offTitle')}
          body={canManage ? t('offBody') : t('offBodyMember')}
          action={canManage ? { label: t('openSettings'), href: '/app/analytics/settings#replay' } : undefined}
        />
      );
    }
    return <EmptyState product="analytics" title={t('emptyTitle')} body={t('emptyBody')} />;
  }

  return (
    <div className="an-persons" aria-busy={loading}>
      {!enabled && (
        <div className="an-callout" role="status">
          <p>{canManage ? t('offNotice') : t('offNoticeMember')}</p>
          {canManage && (
            <Link href="/app/analytics/settings#replay" className="btn btn-sm">
              {t('openSettings')}
            </Link>
          )}
        </div>
      )}
      <div className="an-toolbar an-replay-filters">
        <input className="input" type="search" placeholder={t('filterPerson')} aria-label={t('filterPerson')} value={person} onChange={(e) => setPerson(e.target.value)} />
        <input className="input" type="search" placeholder={t('filterUrl')} aria-label={t('filterUrl')} value={url} onChange={(e) => setUrl(e.target.value)} />
        <RangeSelect value={range} onChange={setRange} />
        <select className="select an-range" aria-label={t('filterDuration')} value={minSeconds} onChange={(e) => setMinSeconds(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? t('anyDuration') : t('minDuration', { value: fmtDuration(d * 1000) })}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState product="analytics" compact title={error ? undefined : t('noMatch')} body={error ? t('error') : undefined} />
      ) : (
        <div className="table-wrap table-stack">
          <table className="table table-compact an-table" data-testid="an-recordings">
            <thead>
              <tr>
                <th scope="col">{t('person')}</th>
                <th scope="col">{t('start')}</th>
                <th scope="col">{t('duration')}</th>
                <th scope="col">{t('clicks')}</th>
                <th scope="col">{t('firstUrl')}</th>
                <th scope="col">
                  <span className="sr-only">{tc('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="an-recording-row">
                  <td>
                    <Link href={`/app/analytics/replay/${r.id}`} className="an-row-link an-replay-person">
                      {r.person}
                    </Link>
                  </td>
                  <td className="an-muted an-nowrap" data-label={t('start')}>
                    {mounted ? fmtTime(r.startTs, locale) : ''}
                  </td>
                  <td className="an-nowrap" data-label={t('duration')}>
                    {fmtDuration(r.durationMs)}
                  </td>
                  <td data-label={t('clicks')}>{r.clicks}</td>
                  <td className="an-muted" data-label={t('firstUrl')}>
                    <span className="an-replay-url" title={r.firstUrl ?? undefined}>
                      {urlPath(r.firstUrl)}
                    </span>
                  </td>
                  <td className="an-replay-rowactions">
                    <Link href={`/app/analytics/replay/${r.id}`} className="btn btn-sm">
                      {t('watch')}
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={!canManage}
                      title={canManage ? undefined : t('deleteAdminsOnly')}
                      aria-label={t('deleteRow', { name: r.person })}
                      onClick={() => setDeleting(r)}
                    >
                      {tc('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <button type="button" className="btn btn-sm" onClick={() => void more()} disabled={loading}>
          {t('more')}
        </button>
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('deleteTitle')}
        body={t('deleteBody')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api(`/api/analytics/replay/${deleting.id}`, { method: 'DELETE' });
            setRows((p) => p.filter((x) => x.id !== deleting.id));
            setError(false);
          } catch {
            setError(true);
          } finally {
            setBusy(false);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
