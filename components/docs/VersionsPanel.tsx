'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DocsBlock, DocsVersionSummary } from '@/lib/docs-types';
import { formatDateTime, formatTimeAgo } from '@/lib/datetime';
import DocsBlocksView from './DocsBlocksView';

interface VersionDetail extends DocsVersionSummary {
  content: DocsBlock[];
}

/**
 * Historial de versiones (panel lateral del editor): lista con autor y hora,
 * vista previa de solo lectura y restaurar. "Guardar versión" fuerza un snapshot.
 */
export default function VersionsPanel({
  pageId,
  canEdit,
  onRestored,
}: {
  pageId: string;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const t = useTranslations('docs.versions');
  const locale = useLocale();
  const [rows, setRows] = useState<DocsVersionSummary[] | null>(null);
  const [preview, setPreview] = useState<VersionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/docs/pages/${pageId}/versions`);
    if (!res.ok) return setRows([]);
    const data = (await res.json()) as { rows: DocsVersionSummary[] };
    setRows(data.rows);
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveVersion() {
    setBusy(true);
    try {
      const res = await fetch(`/api/docs/pages/${pageId}/versions`, { method: 'POST' });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    const res = await fetch(`/api/docs/pages/${pageId}/versions/${id}`);
    if (res.ok) setPreview((await res.json()) as VersionDetail);
  }

  async function restore() {
    if (!preview || !window.confirm(t('restoreConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/docs/pages/${pageId}/versions/${preview.id}/restore`, { method: 'POST' });
      if (res.ok) {
        setPreview(null);
        await load();
        onRestored();
      }
    } finally {
      setBusy(false);
    }
  }

  const who = (v: DocsVersionSummary) => v.author_name || v.author_email || t('unknownAuthor');

  if (preview) {
    return (
      <div className="docs-versions">
        <div className="docs-versions-head">
          <button type="button" className="docs-versions-back" onClick={() => setPreview(null)}>
            ‹ {t('back')}
          </button>
          {canEdit && (
            <button type="button" className="btn btn-solid btn-small" onClick={restore} disabled={busy}>
              {t('restore')}
            </button>
          )}
        </div>
        <p className="docs-versions-meta">
          {formatDateTime(preview.created_at, locale)} · {who(preview)}
        </p>
        <div className="docs-versions-preview">
          <h3 className="docs-versions-title">{preview.title || t('untitled')}</h3>
          <DocsBlocksView blocks={preview.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="docs-versions">
      <div className="docs-versions-head">
        <p className="section-label">{t('title')}</p>
        {canEdit && (
          <button type="button" className="btn btn-small" onClick={saveVersion} disabled={busy}>
            {saved ? t('saved') : t('save')}
          </button>
        )}
      </div>
      {rows === null ? (
        <p className="muted mono docs-versions-empty">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="muted docs-versions-empty">{t('empty')}</p>
      ) : (
        <ul className="docs-versions-list">
          {rows.map((v) => (
            <li key={v.id}>
              <button type="button" className="docs-versions-row" onClick={() => open(v.id)}>
                <span className="docs-versions-when" title={formatDateTime(v.created_at, locale)}>
                  {formatTimeAgo(v.created_at, locale)}
                </span>
                <span className="docs-versions-who">
                  {who(v)}
                  {v.kind !== 'auto' && <span className="docs-versions-kind"> · {t(`kinds.${v.kind}`)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="docs-versions-note muted">{t('note')}</p>
    </div>
  );
}
