'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { uploadMedia } from './mediaUpload';
import { parseDbUtc } from '@/lib/utils';

export interface DocumentItem {
  id: string;
  name: string;
  filename: string;
  size: number;
  links: number;
  views: number;
  last_viewed_at: string | null;
  updated_at: string;
  canManage: boolean;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Biblioteca de documentos (como Documents de HubSpot): subir PDFs, buscar,
 * renombrar y borrar. Cada documento se abre para crear links de seguimiento.
 */
export default function DocumentsLibrary({ initial, direct }: { initial: DocumentItem[]; direct: boolean }) {
  const t = useTranslations('crm.media');
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<DocumentItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.filename.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError(t('errors.pdf_only'));
      return;
    }
    setBusy(true);
    const res = await uploadMedia<DocumentItem>({
      kind: 'document',
      file,
      filename: file.name,
      direct,
      fields: { name: file.name.replace(/\.pdf$/i, '') },
    });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      setError(t.has(`errors.${res.code}`) ? t(`errors.${res.code}`) : t('errors.generic'));
      return;
    }
    router.push(`/app/crm/documents/${res.row.id}`);
  }

  async function rename() {
    if (!renaming?.name.trim()) return;
    const res = await fetch(`/api/crm/documents/${renaming.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: renaming.name.trim() }),
    }).catch(() => null);
    if (res?.ok) {
      setRows((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, name: renaming.name.trim() } : r)));
      setRenaming(null);
      router.refresh();
    } else setError(t('errors.generic'));
  }

  async function remove(doc: DocumentItem) {
    setBusy(true);
    const res = await fetch(`/api/crm/documents/${doc.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirm(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== doc.id));
      router.refresh();
    } else setError(t('errors.generic'));
  }

  const fmt = (d: string | null) =>
    d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(d)) : '';

  const uploadButton = (
    <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} aria-busy={busy || undefined} disabled={busy}>
      {busy ? t('uploading') : t('uploadPdf')}
    </button>
  );

  return (
    <div className="media-lib" data-testid="documents-library">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="document-file"
        onChange={(e) => void onFiles(e.target.files)}
      />
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t('docsEmptyTitle')} body={t('docsEmptyBody')} action={uploadButton} />
      ) : (
        <>
          <div className="media-toolbar">
            <input
              className="input media-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchDocs')}
              aria-label={t('searchDocs')}
            />
            {uploadButton}
          </div>
          {shown.length === 0 ? (
            <p className="ui-help">{t('noMatches')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table crm-stack media-table">
                <caption className="sr-only">{t('docsTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colName')}</th>
                    <th scope="col" className="num">
                      {t('colLinks')}
                    </th>
                    <th scope="col" className="num">
                      {t('colViews')}
                    </th>
                    <th scope="col">{t('colLastView')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('colActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => (
                    <tr key={d.id}>
                      <td className="crm-stack-main">
                        {renaming?.id === d.id ? (
                          <form
                            className="media-rename"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void rename();
                            }}
                          >
                            <input
                              className="input"
                              autoFocus
                              value={renaming.name}
                              aria-label={t('rename')}
                              onChange={(e) => setRenaming({ id: d.id, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              maxLength={200}
                            />
                            <button type="submit" className="btn btn-secondary btn-sm">
                              {t('save')}
                            </button>
                          </form>
                        ) : (
                          <>
                            <Link href={`/app/crm/documents/${d.id}`} className="cell-link">
                              {d.name}
                            </Link>
                            <span className="muted media-sub data">
                              {d.filename} · {fmtSize(d.size)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="num data" data-label={t('colLinks')}>
                        {d.links}
                      </td>
                      <td className="num data" data-label={t('colViews')}>
                        {d.views}
                      </td>
                      <td className="data" data-label={t('colLastView')}>
                        {d.last_viewed_at ? fmt(d.last_viewed_at) : <span className="muted">{t('never')}</span>}
                      </td>
                      <td className="media-actions">
                        {d.canManage && (
                          <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming({ id: d.id, name: d.name })}>
                              {t('rename')}
                            </button>
                            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(d)}>
                              {t('delete')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t('deleteDocTitle', { name: confirm.name }) : ''}
        body={t('deleteDocBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => confirm && remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
