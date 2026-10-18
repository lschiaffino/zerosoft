'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { FlowDto, FlowVersionDto } from '@/lib/flow';
import { i18nKey } from './flow-ui';

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
  const te = useTranslations('flow.editor');
  const tf = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [versions, setVersions] = useState<FlowVersionDto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/flow/flows/${flowId}/versions`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { versions?: FlowVersionDto[] } | null;
    setLoadError(!res?.ok || !data?.versions);
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

  if (versions === null) {
    return (
      <div className="flow-versions" aria-busy="true">
        <div className="ui-loading-stack">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }

  return (
    <div className="flow-versions">
      <div className="flow-versions-head">
        <h2 className="flow-panel-title">{t('title')}</h2>
        <p className="ui-help">{t('subtitle')}</p>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {loadError ? (
        <div className="flow-load-error" role="alert">
          <p className="ui-error">{t('loadError')}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            {te('retry')}
          </button>
        </div>
      ) : versions.length === 0 ? (
        <EmptyState product="flow" quiet title={t('emptyTitle')} body={t('subtitle')} />
      ) : (
        <ol className="flow-version-list">
          {versions.map((v, i) => {
            // Títulos de los nodos ("Slack: enviar mensaje"), no sus ids internos.
            const names = (ids: string[]) =>
              ids
                .map((id) => {
                  const key = v.nodeTypes?.[id] ? `nodes.${i18nKey(v.nodeTypes[id])}.title` : '';
                  return key && tf.has(key) ? tf(key) : id;
                })
                .join(', ');
            const parts: string[] = [];
            if (v.diff.added.length) parts.push(t('added', { names: names(v.diff.added) }));
            if (v.diff.removed.length) parts.push(t('removed', { names: names(v.diff.removed) }));
            if (v.diff.changed.length) parts.push(t('changed', { names: names(v.diff.changed) }));
            if (v.diff.edgesAdded) parts.push(t('edgesAdded', { n: v.diff.edgesAdded }));
            if (v.diff.edgesRemoved) parts.push(t('edgesRemoved', { n: v.diff.edgesRemoved }));
            const current = i === 0;
            return (
              <li key={v.id} className="flow-version" aria-current={current ? 'true' : undefined}>
                <div className="flow-version-main">
                  <span className="flow-version-n data">v{v.version}</span>
                  <span suppressHydrationWarning>{format.relativeTime(new Date(v.createdAt), now)}</span>
                  <span className="flow-muted">{t('nodes', { n: v.nodeCount })}</span>
                  {current && <span className="badge badge-ink">{t('current')}</span>}
                </div>
                <p className="flow-version-diff">
                  {i === versions.length - 1 && parts.length === 0 ? t('first') : parts.join(' · ') || t('noChanges')}
                </p>
                {canEdit && !current && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm flow-version-restore"
                    disabled={busy !== null && busy !== v.id}
                    aria-busy={busy === v.id || undefined}
                    aria-label={`${t('restore')} v${v.version}`}
                    onClick={() => void restore(v)}
                  >
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
