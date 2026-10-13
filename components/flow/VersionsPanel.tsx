'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { FlowDto, FlowVersionDto } from '@/lib/flow';

interface Props {
  flowId: string;
  /** Versión actual del flow (para marcarla). */
  currentVersion: number;
  canEdit: boolean;
  dirty: boolean;
  onRestored: (flow: FlowDto, webhooks: Array<{ nodeId: string; token: string }>) => void;
}

/** Historial de versiones: una por guardado con cambios, con diff y restaurar. */
export default function VersionsPanel({ flowId, currentVersion, canEdit, dirty, onRestored }: Props) {
  const t = useTranslations('flow.versions');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [versions, setVersions] = useState<FlowVersionDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/flow/flows/${flowId}/versions`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { versions?: FlowVersionDto[] } | null;
    setVersions(data?.versions ?? []);
  }, [flowId]);

  useEffect(() => {
    void load();
  }, [load, currentVersion]);

  async function restore(v: FlowVersionDto) {
    if (!window.confirm(dirty ? t('confirmDirty', { n: v.version }) : t('confirm', { n: v.version }))) return;
    setBusy(v.id);
    setError(null);
    const res = await fetch(`/api/flow/flows/${flowId}/versions/${v.id}`, { method: 'POST' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { flow?: FlowDto; webhooks?: Array<{ nodeId: string; token: string }> } | null;
    setBusy(null);
    if (!res?.ok || !data?.flow) {
      setError(t('error'));
      return;
    }
    onRestored(data.flow, data.webhooks ?? []);
  }

  if (versions === null) return <p className="muted flow-pad">{t('loading')}</p>;

  return (
    <div className="flow-versions">
      <div className="flow-runs-head">
        <h3>{t('title')}</h3>
        <span className="muted">{t('subtitle')}</span>
      </div>
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}
      {versions.length === 0 ? (
        <p className="muted flow-pad">{t('empty')}</p>
      ) : (
        <ol className="flow-version-list">
          {versions.map((v, i) => {
            const parts: string[] = [];
            if (v.diff.added.length) parts.push(t('added', { n: v.diff.added.length, ids: v.diff.added.join(', ') }));
            if (v.diff.removed.length) parts.push(t('removed', { n: v.diff.removed.length, ids: v.diff.removed.join(', ') }));
            if (v.diff.changed.length) parts.push(t('changed', { n: v.diff.changed.length, ids: v.diff.changed.join(', ') }));
            if (v.diff.edgesAdded || v.diff.edgesRemoved) parts.push(t('edges', { added: v.diff.edgesAdded, removed: v.diff.edgesRemoved }));
            return (
              <li key={v.id} className="flow-version">
                <div className="flow-version-main">
                  <span className="flow-version-n mono">v{v.version}</span>
                  <span className="flow-version-when" suppressHydrationWarning>
                    {format.relativeTime(new Date(v.createdAt), now)}
                    <span className="muted"> · {t('nodes', { n: v.nodeCount })}</span>
                  </span>
                  {i === 0 && <span className="muted flow-version-current">{t('current')}</span>}
                </div>
                <p className="muted flow-version-diff">{i === versions.length - 1 && parts.length === 0 ? t('first') : parts.join(' · ') || t('noChanges')}</p>
                {canEdit && i > 0 && (
                  <button type="button" className="btn btn-small btn-ghost" disabled={busy !== null} onClick={() => void restore(v)}>
                    {busy === v.id ? t('restoring') : t('restore')}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
