'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CopyButton from './CopyButton';

export interface TableRow {
  id: string;
  slug: string;
  short: string;
  url: string;
  title: string | null;
  tags: string[];
  clicks: number;
  created: string;
  status: 'active' | 'archived' | 'expired' | 'limit' | 'protected';
}

interface LinksTableProps {
  rows: TableRow[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function LinksTable({ rows }: LinksTableProps) {
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
      setNotice({ kind: 'error', text: t('errors.generic') });
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

  const statusLabel: Record<TableRow['status'], string> = {
    active: t('table.statusActive'),
    archived: t('table.statusArchived'),
    expired: t('table.statusExpired'),
    limit: t('table.statusLimit'),
    protected: t('table.statusProtected'),
  };

  return (
    <div className="table-wrap">
      {notice && (
        <p className={notice.kind === 'error' ? 'form-error mono' : 'field-hint'} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      {visibleSelected.length > 0 && (
        <div className="links-bulk-bar" role="toolbar" aria-label={t('bulkActions.label')} data-testid="links-bulk-bar">
          <span className="links-bulk-count mono">{t('bulkActions.selected', { count: visibleSelected.length })}</span>
          {bulkConfirm ? (
            <>
              <span className="confirm-label">{t('bulkActions.confirmDelete', { count: visibleSelected.length })}</span>
              <button type="button" className="btn btn-small danger" onClick={() => bulk({ action: 'delete' })} disabled={bulkBusy}>
                {t('common.yes')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => setBulkConfirm(false)}>
                {t('common.no')}
              </button>
            </>
          ) : tagOpen ? (
            <form
              className="links-bulk-tag"
              onSubmit={(e) => {
                e.preventDefault();
                if (tag.trim()) void bulk({ action: 'tag', tag: tag.trim() });
              }}
            >
              <input
                autoFocus
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                maxLength={40}
                placeholder={t('bulkActions.tagPlaceholder')}
                aria-label={t('bulkActions.tagPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTagOpen(false);
                }}
              />
              <button type="submit" className="btn btn-small btn-solid" disabled={!tag.trim() || bulkBusy}>
                {t('bulkActions.applyTag')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => setTagOpen(false)}>
                {t('common.cancel')}
              </button>
            </form>
          ) : (
            <>
              <button type="button" className="btn btn-small" onClick={() => bulk({ action: 'archive' })} disabled={bulkBusy}>
                {t('common.archive')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => bulk({ action: 'unarchive' })} disabled={bulkBusy}>
                {t('common.unarchive')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => setTagOpen(true)} disabled={bulkBusy}>
                {t('bulkActions.tag')}
              </button>
              <button type="button" className="btn btn-small danger" onClick={() => setBulkConfirm(true)} disabled={bulkBusy}>
                {t('common.delete')}
              </button>
            </>
          )}
          <button type="button" className="links-bulk-clear" onClick={() => setSelected(new Set())}>
            {t('bulkActions.clear')}
          </button>
        </div>
      )}
      <table className="table links-table">
        <thead>
          <tr>
            <th className="td-check">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = visibleSelected.length > 0 && !allSelected;
                }}
                onChange={toggleAll}
                aria-label={t('bulkActions.selectAll')}
              />
            </th>
            <th>{t('table.link')}</th>
            <th>{t('table.destination')}</th>
            <th>{t('table.tags')}</th>
            <th className="th-num">{t('table.clicks')}</th>
            <th>{t('table.created')}</th>
            <th>{t('table.status')}</th>
            <th aria-label={t('table.actions')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`links-row${busyId === row.id ? ' row-busy' : ''}${selected.has(row.id) ? ' row-selected' : ''}`}
            >
              <td className="td-check">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  aria-label={t('bulkActions.select', { slug: row.slug })}
                />
              </td>
              <td className="td-link">
                <div className="cell-link">
                  <Link href={`/app/links/${row.id}`} className="mono cell-slug" title={row.short}>
                    {row.short.replace(/^https?:\/\//, '')}
                  </Link>
                  <CopyButton text={row.short} className="copy-btn-icon" />
                </div>
                {row.title && <div className="cell-title muted">{truncate(row.title, 32)}</div>}
              </td>
              <td className="td-dest">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cell-url muted"
                  title={row.url}
                >
                  {row.url}
                </a>
              </td>
              <td className="td-tags">
                <div className="cell-tags">
                  {row.tags.map((tag) => (
                    <span key={tag} className="badge">
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td className="mono td-num td-clicks">{row.clicks}</td>
              <td className="mono muted cell-date">{row.created}</td>
              <td className="td-status">
                <span className={`badge status-${row.status}`}>{statusLabel[row.status]}</span>
              </td>
              <td className="td-actions">
                {confirmingId === row.id ? (
                  <div className="cell-actions confirm">
                    <span className="confirm-label">{t('table.confirmDelete')}</span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => remove(row.id)}
                    >
                      {t('common.yes')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setConfirmingId(null)}
                    >
                      {t('common.no')}
                    </button>
                  </div>
                ) : (
                  <div className="cell-actions">
                    <Link href={`/app/links/${row.id}#qr`} className="icon-btn" title={t('table.qr')}>
                      ▦
                    </Link>
                    <Link href={`/app/links/${row.id}?edit=1`} className="icon-btn" title={t('common.edit')}>
                      ✎
                    </Link>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => patch(row.id, { archived: row.status !== 'archived' })}
                      title={row.status === 'archived' ? t('common.unarchive') : t('common.archive')}
                    >
                      {row.status === 'archived' ? '↥' : '↧'}
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setConfirmingId(row.id)}
                      title={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
