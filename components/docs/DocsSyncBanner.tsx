'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocsDatabase } from '@/lib/docs-types';
import DocsGlyph from './DocsGlyphs';

interface SourceStatus {
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  lastSyncedAt: string | null;
  itemCount: number;
}

/**
 * Cabecera de una base sincronizada: de dónde viene, cuándo se actualizó,
 * "Sincronizar ahora" y "Desvincular" (queda como una base común con las
 * filas que tenía). Las filas son de solo lectura.
 */
export default function DocsSyncBanner({ db, canEdit, onDb }: { db: DocsDatabase; canEdit: boolean; onDb: (next: DocsDatabase) => void }) {
  const t = useTranslations('docs.sync');
  const format = useFormatter();
  const sync = db.sync!;
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [busy, setBusy] = useState<'sync' | 'unlink' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/docs/sync/${encodeURIComponent(sync.source_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { source?: SourceStatus } | null) => {
        if (alive && d?.source) setStatus(d.source);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sync.source_id, sync.synced_at]);

  const syncNow = async () => {
    setBusy('sync');
    setError(null);
    try {
      const res = await fetch(`/api/docs/sync/${encodeURIComponent(sync.source_id)}`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { source?: SourceStatus; db?: DocsDatabase; error?: string };
      if (!res.ok) setError(data.error ?? 'failed');
      if (data.source) setStatus(data.source);
      if (data.db) onDb({ ...data.db, views: db.views, active_view: db.active_view });
    } catch {
      setError('network_error');
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy('unlink');
    try {
      const res = await fetch(`/api/docs/sync/${encodeURIComponent(sync.source_id)}`, { method: 'DELETE' });
      if (res.ok || res.status === 404) {
        const { sync: _s, ...rest } = db;
        void _s;
        onDb(rest);
      } else setError('failed');
    } catch {
      setError('network_error');
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  const when = sync.synced_at ? format.relativeTime(new Date(sync.synced_at), new Date()) : null;
  const sourceError = status?.status === 'error' ? status.error : null;
  return (
    <div className="docs-sync-banner" data-testid="docs-sync-banner">
      <DocsGlyph name="sync" size={13} />
      <span className="docs-sync-label">
        {t('syncedFrom', { provider: t(`providers.${sync.provider}`) })} · <span className="docs-sync-source">{sync.label}</span>
      </span>
      <span className="docs-sync-when">{when ? t('updated', { when }) : t('neverSynced')}</span>
      <span className="docs-sync-ro">{t('readOnly')}</span>
      {(sourceError || error) && (
        <span className="ui-error docs-sync-err" role="alert">
          {t(`errors.${['auth_failed', 'source_not_found', 'rate_limited', 'timeout', 'missing_token'].includes(sourceError ?? error ?? '') ? sourceError ?? error : 'generic'}`)}
        </span>
      )}
      {canEdit && (
        <span className="docs-sync-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void syncNow()} disabled={busy !== null} aria-busy={busy === 'sync' || undefined} data-testid="docs-sync-now">
            {busy === 'sync' ? t('syncing') : t('syncNow')}
          </button>
          {confirm ? (
            <>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void unlink()} disabled={busy !== null}>
                {t('unlinkConfirm')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
                {t('cancel')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(true)} title={t('unlinkHelp')}>
              {t('unlink')}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
