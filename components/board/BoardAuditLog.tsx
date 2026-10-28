'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import { BOARD_AUDIT_ACTIONS, type BoardAuditEntry } from '@/lib/board-audit-types';
import { parseDbUtc } from '@/lib/utils';

/** Registro de actividad de Board (owner y admins): filtro por acción, más viejos y CSV. */
export default function BoardAuditLog() {
  const t = useTranslations('board.audit');
  const format = useFormatter();
  const locale = useLocale();
  const uid = useId();
  const [rows, setRows] = useState<BoardAuditEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [action, setAction] = useState('');
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      setError(false);
      try {
        const p = new URLSearchParams();
        if (action) p.set('action', action);
        if (before) p.set('before', before);
        const res = await fetch(`/api/boards/audit?${p.toString()}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { entries: BoardAuditEntry[] };
        setRows((prev) => (before && prev ? [...prev, ...data.entries] : data.entries));
        setMore(data.entries.length >= 100);
      } catch {
        setError(true);
        setRows((prev) => prev ?? []);
      }
    },
    [action],
  );

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  /** Qué cambió, en palabras: de qué nombre a cuál, a quién, a qué carpeta, prendido o apagado. */
  function detail(r: BoardAuditEntry): string {
    const d = r.data;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    switch (r.action) {
      case 'board.renamed':
      case 'folder.renamed':
        return str(d.from) ? t('detail.renamed', { from: str(d.from), to: str(r.action === 'folder.renamed' ? d.name : r.boardName) }) : '';
      case 'board.moved':
        return d.folderId ? t('detail.movedTo', { folder: str(d.folderName) || '?' }) : t('detail.movedOut');
      case 'access.mode':
        return d.mode === 'restricted' ? t('detail.restricted') : t('detail.workspace');
      case 'access.member':
        return d.role ? t('detail.member', { name: str(d.userName) || '?', role: d.role === 'view' ? t('detail.view') : t('detail.edit') }) : t('detail.memberRemoved', { name: str(d.userName) || '?' });
      case 'access.guest_link':
      case 'share.link':
        return d.on ? t('detail.on') : t('detail.off');
      case 'folder.created':
      case 'folder.deleted':
        return str(d.name);
      case 'board.created':
        return str(d.template) ? t('detail.template', { template: str(d.template) }) : '';
      default:
        return '';
    }
  }

  const csvHref = `/api/boards/audit?format=csv${action ? `&action=${encodeURIComponent(action)}` : ''}`;
  return (
    <FormSection
      title={t('title')}
      description={t('help')}
      footer={
        <a className="btn btn-secondary btn-sm" href={csvHref} download data-testid="board-audit-csv">
          {t('csv')}
        </a>
      }
    >
      <div className="board-audit-filters">
        <div className="ui-field">
          <label className="label" htmlFor={`${uid}-act`}>
            {t('action')}
          </label>
          <select id={`${uid}-act`} className="select" value={action} onChange={(e) => setAction(e.target.value)} data-testid="board-audit-action">
            <option value="">{t('all')}</option>
            {BOARD_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`actions.${a.replace('.', '_')}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <div role="alert">
          <p className="ui-error">{t('error')}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      ) : rows === null ? (
        <div className="ui-loading-stack" aria-busy="true" aria-label={t('loading')}>
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState quiet product="board" title={t('empty')} />
      ) : (
        <div className="board-audit-wrap">
          <table className="board-audit" data-testid="board-audit-table">
            <thead>
              <tr>
                <th scope="col">{t('when')}</th>
                <th scope="col">{t('who')}</th>
                <th scope="col">{t('action')}</th>
                <th scope="col">{t('board')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">{format.dateTime(parseDbUtc(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>
                    {r.actorName ?? t('system')}
                    {r.via !== 'app' && <span className="ui-help"> · {r.via.toUpperCase()}</span>}
                  </td>
                  <td>
                    {t(`actions.${r.action.replace('.', '_')}`)}
                    {detail(r) && <span className="ui-help board-audit-detail">{detail(r)}</span>}
                  </td>
                  <td>
                    {r.boardId && r.boardAlive ? (
                      <a href={`/${locale}/app/board/${r.boardId}`} className="board-audit-link">
                        {r.boardName || r.boardId}
                      </a>
                    ) : (
                      (r.boardName ?? (typeof r.data.name === 'string' ? r.data.name : ''))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(rows[rows.length - 1]?.createdAt)}>
              {t('more')}
            </button>
          )}
        </div>
      )}
    </FormSection>
  );
}
