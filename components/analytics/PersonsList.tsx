'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { personLabel, type PersonRow } from '@/lib/analytics/types';
import { api, fmtTime } from './client';

/** Personas del proyecto con búsqueda (distinct_id, email, cualquier propiedad) y paginado. */
export default function PersonsList({
  projectId,
  initial,
  initialHasMore,
  cohortId,
  ids,
}: {
  projectId: string;
  initial: PersonRow[];
  initialHasMore: boolean;
  cohortId?: string | null;
  ids?: string | null;
}) {
  const t = useTranslations('analytics.persons');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [persons, setPersons] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const params = (offset: number) => {
    const sp = new URLSearchParams({ project: projectId, offset: String(offset) });
    if (q.trim()) sp.set('q', q.trim());
    if (cohortId) sp.set('cohort', cohortId);
    if (ids) sp.set('ids', ids);
    return `/api/analytics/persons?${sp}`;
  };

  useEffect(() => {
    if (!q.trim()) {
      setPersons(initial);
      setHasMore(initialHasMore);
      return;
    }
    const id = setTimeout(() => {
      setLoading(true);
      api<{ persons: PersonRow[]; hasMore: boolean }>(params(0))
        .then((r) => {
          setPersons(r.persons);
          setHasMore(r.hasMore);
          setError(false);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, initial]);

  const more = async () => {
    setLoading(true);
    try {
      const r = await api<{ persons: PersonRow[]; hasMore: boolean }>(params(persons.length));
      setPersons((p) => [...p, ...r.persons]);
      setHasMore(r.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="an-persons" aria-busy={loading}>
      <div className="an-toolbar">
        <input className="input an-search" type="search" placeholder={t('search')} aria-label={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {(cohortId || ids) && (
          <Link href="/app/analytics/persons" className="an-link">
            {t('clearFilter')}
          </Link>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {persons.length === 0 ? (
        <EmptyState product="analytics" compact title={q ? t('noMatch') : t('emptyTitle')} body={q ? undefined : t('emptyBody')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-compact an-table">
            <thead>
              <tr>
                <th scope="col">{t('person')}</th>
                <th scope="col" className="an-hide-sm">
                  {t('distinctId')}
                </th>
                <th scope="col">{t('lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/app/analytics/persons/${p.id}`} className="an-row-link">
                      {personLabel(p)}
                    </Link>
                    {p.isIdentified && <span className="badge badge-outline an-badge">{t('identified')}</span>}
                  </td>
                  <td className="an-mono an-ellipsis an-hide-sm">{p.distinctIds[0] ?? ''}</td>
                  <td className="an-muted an-nowrap">{fmtTime(p.lastSeen, locale)}</td>
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
    </div>
  );
}
