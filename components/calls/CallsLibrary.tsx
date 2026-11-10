'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { CallListItem } from '@/lib/calls/core';
import { durationRange } from '@/lib/calls/filters';
import NewCallDialog from './NewCallDialog';
import { MOVING, StatusBadge, useDate, useDuration } from './ui';

export interface LibraryFilters {
  q: string;
  owner: string;
  deal: string;
  from: string;
  to: string;
  duration: string;
}


/** Biblioteca de llamadas: búsqueda en lo que se dijo, filtros, tabla y llamada nueva. */
export default function CallsLibrary({
  items,
  reps,
  deals,
  filters,
  botConfigured,
  openNew,
}: {
  items: CallListItem[];
  reps: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; name: string }>;
  filters: LibraryFilters;
  botConfigured: boolean;
  openNew: boolean;
}) {
  const t = useTranslations('calls');
  const router = useRouter();
  const date = useDate();
  const dur = useDuration();
  const [f, setF] = useState<LibraryFilters>(filters);
  const [newOpen, setNewOpen] = useState(openNew);
  const filtered = Boolean(filters.q || filters.owner || filters.deal || filters.from || filters.to || filters.duration);

  // Llamadas en curso: la lista se actualiza sola (cada 6 s, solo con la pestaña visible).
  const moving = items.some((c) => MOVING.includes(c.status));
  useEffect(() => {
    if (!moving) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 6000);
    return () => window.clearInterval(id);
  }, [moving, router]);

  const query = (next: LibraryFilters) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `?${s}` : '';
  };
  const apply = (next: LibraryFilters) => router.push(`/app/calls${query(next)}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    apply({ ...f, q: f.q.trim() });
  };
  const set = (k: keyof LibraryFilters, v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    if (k !== 'q') apply(next);
  };
  const exportHref = `/api/calls/export${(() => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set('q', filters.q);
    if (filters.owner) sp.set('owner', filters.owner);
    if (filters.deal) sp.set('deal', filters.deal);
    if (filters.from) sp.set('from', filters.from);
    if (filters.to) sp.set('to', filters.to);
    const r = durationRange(filters.duration);
    if (r.minMinutes) sp.set('minMinutes', String(r.minMinutes));
    if (r.maxMinutes) sp.set('maxMinutes', String(r.maxMinutes));
    const s = sp.toString();
    return s ? `?${s}` : '';
  })()}`;

  return (
    <div className="app-page ui-page cl-page">
      <PageHeader
        title={t('library.title')}
        description={t('library.desc')}
        actions={
          <>
            {items.length > 0 && (
              <a className="btn btn-ghost" href={exportHref} download data-testid="calls-export-csv">
                {t('library.export')}
              </a>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)} data-testid="calls-new">
              {t('nav.new')}
            </button>
          </>
        }
      />
      {(items.length > 0 || filtered) && (
        <form onSubmit={submit} className="cl-filters" role="search">
          <input className="input cl-filter-q" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t('library.search')} aria-label={t('library.search')} data-testid="calls-search" />
          <select className="select" value={f.owner} onChange={(e) => set('owner', e.target.value)} aria-label={t('library.rep')} data-testid="calls-filter-rep">
            <option value="">{t('library.anyRep')}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {deals.length > 0 && (
            <select className="select" value={f.deal} onChange={(e) => set('deal', e.target.value)} aria-label={t('library.deal')}>
              <option value="">{t('library.anyDeal')}</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <select className="select" value={f.duration} onChange={(e) => set('duration', e.target.value)} aria-label={t('library.duration')} data-testid="calls-filter-duration">
            <option value="">{t('library.anyDuration')}</option>
            <option value="short">{t('library.short')}</option>
            <option value="medium">{t('library.medium')}</option>
            <option value="long">{t('library.long')}</option>
          </select>
          <label className="cl-date">
            <span>{t('library.from')}</span>
            <input className="input" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="cl-date">
            <span>{t('library.to')}</span>
            <input className="input" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
          </label>
          {filtered && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const empty = { q: '', owner: '', deal: '', from: '', to: '', duration: '' };
                setF(empty);
                apply(empty);
              }}
            >
              {t('library.clear')}
            </button>
          )}
        </form>
      )}
      {items.length === 0 ? (
        filtered ? (
          <EmptyState compact body={t('library.noMatch')} />
        ) : (
          <EmptyState
            product="calls"
            title={t('library.emptyTitle')}
            body={t('library.emptyBody')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                {t('nav.new')}
              </button>
            }
            secondary={<Link href="/app/calls/upcoming">{t('library.emptyUpcoming')}</Link>}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table cl-table">
            <thead>
              <tr>
                <th scope="col">{t('library.colCall')}</th>
                <th scope="col" className="cl-hide-sm">
                  {t('library.colRep')}
                </th>
                <th scope="col" className="cl-hide-sm">
                  {t('library.colDeal')}
                </th>
                <th scope="col" className="num">
                  {t('library.colDuration')}
                </th>
                <th scope="col" className="num cl-hide-sm">
                  {t('library.colTalk')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} data-testid="calls-row">
                  <th scope="row">
                    <Link href={`/app/calls/call/${c.id}`} className="cl-rowlink">
                      <span className="cl-rowtitle">{c.title || t('call.untitled')}</span>
                      <span className="cl-rowmeta">
                        {date(c.at)}
                        <span className="cl-show-sm">{c.ownerName ? ` · ${c.ownerName}` : ''}</span>
                      </span>
                      {c.summary && <span className="cl-rowsummary">{c.summary}</span>}
                    </Link>
                    <StatusBadge status={c.status} />
                  </th>
                  <td className="cl-hide-sm">{c.ownerName}</td>
                  <td className="cl-hide-sm cl-wrap">{c.deal?.name ?? ''}</td>
                  <td className="num">{c.durationMs > 0 ? dur(c.durationMs) : ''}</td>
                  <td className="num cl-hide-sm">{c.talkRatio === null ? '' : `${Math.round(c.talkRatio * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewCallDialog open={newOpen} onClose={() => setNewOpen(false)} botConfigured={botConfigured} />
    </div>
  );
}
