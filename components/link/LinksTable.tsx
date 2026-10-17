'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { LinkStatus } from '@/lib/links';
import CopyButton from './CopyButton';
import LinkIcon from './LinkIcon';
import StatusBadge from './StatusBadge';

export interface TableRow {
  id: string;
  slug: string;
  short: string;
  url: string;
  title: string | null;
  tags: string[];
  /** Ya formateado para el locale. */
  clicks: string;
  /** Sin formatear: para el plural de "23 clicks" en mobile. */
  clickCount: number;
  created: string;
  status: LinkStatus;
}

export default function LinksTable({ rows }: { rows: TableRow[] }) {
  const t = useTranslations('link');
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tag, setTag] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  // Si la lista cambia (filtros, refresh), solo quedan seleccionadas las filas visibles.
  const visibleSelected = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && visibleSelected.length === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function bulk(body: { action: 'archive' | 'unarchive' | 'delete' } | { action: 'tag'; tag: string }) {
    if (visibleSelected.length === 0) return;
    const total = visibleSelected.length;
    setBulkBusy(true);
    setNotice(null);
    const res = await fetch('/api/links/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, ids: visibleSelected }),
    }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as { affected?: number } | null) : null;
    setBulkBusy(false);
    setBulkConfirm(false);
    setTagOpen(false);
    setTag('');
    if (!res?.ok) {
      setNotice({ kind: 'error', text: t(res?.status === 403 ? 'errors.forbidden' : 'errors.generic') });
    } else {
      // Etiquetar saltea los links que ya tienen 5 tags (o ya tenían esa): se avisa.
      const affected = typeof data?.affected === 'number' ? data.affected : total;
      if (body.action === 'tag' && affected < total) {
        setNotice({ kind: 'info', text: t('bulkActions.tagPartial', { affected, total }) });
      }
      if (body.action === 'delete' || body.action === 'archive' || body.action === 'unarchive') setSelected(new Set());
    }
    router.refresh();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setNotice(null);
    const res = await fetch(`/api/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) setNotice({ kind: 'error', text: t('errors.generic') });
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    setNotice(null);
    const res = await fetch(`/api/links/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmingId(null);
    if (!res?.ok) setNotice({ kind: 'error', text: t('errors.generic') });
    router.refresh();
  }

  return (
    <div className="lk-list">
      {notice && (
        <p className={notice.kind === 'error' ? 'ui-error' : 'ui-help'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      {visibleSelected.length > 0 && (
        <div className="lk-bulkbar" role="toolbar" aria-label={t('bulkActions.label')} data-testid="links-bulk-bar">
          <span className="lk-bulkbar-count">{t('bulkActions.selected', { count: visibleSelected.length })}</span>
          {bulkConfirm ? (
            <>
              <span>{t('bulkActions.confirmDelete', { count: visibleSelected.length })}</span>
              <button
                type="button"
                className="btn btn-sm btn-primary btn-danger"
                onClick={() => bulk({ action: 'delete' })}
                disabled={bulkBusy}
                aria-busy={bulkBusy || undefined}
              >
                {t('bulkActions.deleteN', { count: visibleSelected.length })}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBulkConfirm(false)}>
                {t('common.cancel')}
              </button>
            </>
          ) : tagOpen ? (
            <form
              className="lk-bulkbar-tag"
              onSubmit={(e) => {
                e.preventDefault();
                if (tag.trim()) void bulk({ action: 'tag', tag: tag.trim() });
              }}
            >
              <input
                autoFocus
                className="input"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                maxLength={40}
                placeholder={t('bulkActions.tagPlaceholder')}
                aria-label={t('bulkActions.tagPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTagOpen(false);
                }}
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={!tag.trim() || bulkBusy}>
                {t('bulkActions.applyTag')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTagOpen(false)}>
                {t('common.cancel')}
              </button>
            </form>
          ) : (
            <>
              <button type="button" className="btn btn-sm" onClick={() => bulk({ action: 'archive' })} disabled={bulkBusy}>
                {t('common.archive')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => bulk({ action: 'unarchive' })} disabled={bulkBusy}>
                {t('common.unarchive')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setTagOpen(true)} disabled={bulkBusy}>
                {t('bulkActions.tag')}
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setBulkConfirm(true)} disabled={bulkBusy}>
                {t('common.delete')}
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm btn-ghost lk-bulkbar-clear" onClick={() => setSelected(new Set())}>
            {t('bulkActions.clear')}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table links-table">
          <caption className="sr-only">{t('table.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="lk-col-check">
                <label className="ui-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = visibleSelected.length > 0 && !allSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={t('bulkActions.selectAll')}
                  />
                </label>
              </th>
              <th scope="col">{t('table.link')}</th>
              <th scope="col" className="lk-col-dest">
                {t('table.destination')}
              </th>
              <th scope="col" className="lk-col-tags">
                {t('table.tags')}
              </th>
              <th scope="col" className="num">
                {t('table.clicks')}
              </th>
              <th scope="col" className="lk-col-date">
                {t('table.created')}
              </th>
              <th scope="col">{t('table.status')}</th>
              <th scope="col">
                <span className="sr-only">{t('table.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const shortText = row.short.replace(/^https?:\/\//, '');
              return (
                <tr
                  key={row.id}
                  className={`lk-row${busyId === row.id ? ' lk-row-busy' : ''}`}
                  aria-selected={selected.has(row.id) || undefined}
                >
                  <td className="lk-col-check">
                    <label className="ui-check">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={t('bulkActions.select', { slug: row.slug })}
                      />
                    </label>
                  </td>
                  <td className="lk-col-link">
                    <div className="lk-cell-link">
                      <Link href={`/app/links/${row.id}`} className="cell-link data" title={row.short}>
                        {shortText}
                      </Link>
                      <CopyButton text={row.short} className="btn btn-sm btn-ghost" iconOnly />
                    </div>
                    {row.title && <div className="lk-cell-sub">{row.title}</div>}
                  </td>
                  <td className="lk-col-dest">
                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="lk-dest data" title={row.url}>
                      {row.url.replace(/^https?:\/\//, '')}
                    </a>
                  </td>
                  <td className="lk-col-tags">
                    <div className="lk-cell-tags">
                      {row.tags.map((name) => (
                        <span key={name} className="badge badge-outline">
                          {name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num data lk-col-clicks">
                    <span className="lk-clicks-n">{row.clicks}</span>
                    <span className="lk-clicks-full">{t('table.clicksN', { n: row.clickCount })}</span>
                  </td>
                  <td className="data lk-col-date">{row.created}</td>
                  <td className="lk-col-status">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="lk-col-actions">
                    {confirmingId === row.id ? (
                      <div className="lk-row-actions lk-row-confirm">
                        <span>{t('table.confirmDelete')}</span>
                        <button type="button" className="btn btn-sm btn-primary btn-danger" onClick={() => remove(row.id)}>
                          {t('common.delete')}
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmingId(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="lk-row-actions">
                        <Link
                          href={`/app/links/${row.id}?tab=qr`}
                          className="btn btn-sm btn-ghost btn-icon"
                          title={t('table.qr')}
                          aria-label={`${t('table.qr')}: ${shortText}`}
                        >
                          <LinkIcon name="qr" size={14} />
                        </Link>
                        <Link
                          href={`/app/links/${row.id}?tab=settings`}
                          className="btn btn-sm btn-ghost btn-icon"
                          title={t('common.edit')}
                          aria-label={`${t('common.edit')}: ${shortText}`}
                        >
                          <LinkIcon name="edit" size={14} />
                        </Link>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-icon"
                          onClick={() => patch(row.id, { archived: row.status !== 'archived' })}
                          title={row.status === 'archived' ? t('common.unarchive') : t('common.archive')}
                          aria-label={`${row.status === 'archived' ? t('common.unarchive') : t('common.archive')}: ${shortText}`}
                        >
                          <LinkIcon name={row.status === 'archived' ? 'unarchive' : 'archive'} size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-icon btn-danger"
                          onClick={() => setConfirmingId(row.id)}
                          title={t('common.delete')}
                          aria-label={`${t('common.delete')}: ${shortText}`}
                        >
                          <LinkIcon name="trash" size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
