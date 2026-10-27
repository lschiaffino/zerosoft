'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AgentDto } from '@/lib/agents-config';
import type { AgentChangeDto, AgentVersionDto, AgentVersioningDto } from '@/lib/agents-versions';
import EmptyState from '@/components/ui/EmptyState';
import { parseDbUtc } from '@/lib/utils';
import { api, errorText } from './agents-ui';

/**
 * Pestaña Versiones: versiones publicadas (con "Volver a esta versión") y el
 * registro de quién cambió qué. Publicar y descartar el borrador están en el
 * encabezado del editor; acá también, para quien llega a revisar.
 */
export default function AgentVersions({
  agentId,
  canEdit,
  dirty,
  reloadKey,
  onAgent,
}: {
  agentId: string;
  canEdit: boolean;
  dirty: boolean;
  /** Cambia al guardar o publicar desde el encabezado. */
  reloadKey: number;
  onAgent: (agent: AgentDto, versioning: AgentVersioningDto) => void;
}) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const [versions, setVersions] = useState<AgentVersionDto[] | null>(null);
  const [changes, setChanges] = useState<AgentChangeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await api<{ versions?: AgentVersionDto[]; changes?: AgentChangeDto[] }>(`/api/agents/${agentId}/versions`);
    if (!res.ok) {
      setError(errorText(t, res.data.error));
      return;
    }
    setVersions(res.data.versions ?? []);
    setChanges(res.data.changes ?? []);
  }, [agentId, t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function restore(v: AgentVersionDto) {
    if (dirty) {
      setError(t('versions.saveFirst'));
      return;
    }
    if (!window.confirm(t('versions.restoreConfirm', { number: v.number }))) return;
    setBusy(v.id);
    setError(null);
    const res = await api<{ agent?: AgentDto; versioning?: AgentVersioningDto }>(`/api/agents/${agentId}/versions/${v.id}`, { method: 'POST' });
    setBusy(null);
    if (!res.ok || !res.data.agent || !res.data.versioning) {
      setError(errorText(t, res.data.error));
      return;
    }
    onAgent(res.data.agent, res.data.versioning);
    setNotice(t('versions.restored', { number: v.number }));
    void load();
  }

  const when = (iso: string) => format.dateTime(parseDbUtc(iso), { dateStyle: 'medium', timeStyle: 'short' });

  function describe(c: AgentChangeDto): string {
    const d = c.detail as { fields?: string[]; version?: number; from?: number; name?: string; server?: string; question?: string; action?: string; draft?: boolean };
    const field = (f: string) => (t.has(`versions.fields.${f}` as never) ? t(`versions.fields.${f}` as never) : f);
    switch (c.kind) {
      case 'save':
        return t(d.draft ? 'versions.kinds.saveDraft' : 'versions.kinds.save', { fields: (d.fields ?? []).map(field).join(', ') });
      case 'publish':
        return t('versions.kinds.publish', { number: d.version ?? 0 });
      case 'restore':
        return t('versions.kinds.restore', { number: d.version ?? 0, from: d.from ?? 0 });
      case 'file_added':
      case 'file_removed':
        return t(`versions.kinds.${c.kind}`, { name: d.name ?? '' });
      case 'qa_changed':
        return t(`versions.kinds.qa_${d.action === 'remove' ? 'remove' : d.action === 'edit' ? 'edit' : 'add'}`, { question: d.question ?? '' });
      case 'mcp_changed':
        return t(`versions.kinds.mcp_${d.action === 'remove' ? 'remove' : d.action === 'edit' ? 'edit' : 'add'}`, { server: d.server ?? '' });
      default:
        return t.has(`versions.kinds.${c.kind}` as never) ? t(`versions.kinds.${c.kind}` as never) : c.kind;
    }
  }

  return (
    <div className="ag-block ag-versions">
      <p className="ui-help">{t('versions.hint')}</p>
      {notice && (
        <p className="ui-help" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <section className="ag-block" aria-labelledby="ag-versions-list">
        <h3 id="ag-versions-list" className="ui-section-title">
          {t('versions.title')}
        </h3>
        {versions === null ? (
          <div className="ui-loading-stack" aria-busy="true">
            <span className="sr-only">{t('versions.loading')}</span>
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : versions.length === 0 ? (
          <EmptyState quiet product="agents" title={t('versions.emptyTitle')} body={t('versions.emptyBody')} />
        ) : (
          <ul className="ag-rows">
            {versions.map((v) => (
              <li key={v.id} className="ag-version">
                <span className="ag-version-num data">v{v.number}</span>
                <span className="ag-version-main">
                  <span>{v.note || t('versions.noNote')}</span>
                  <span className="ui-help">
                    {when(v.createdAt)}
                    {v.createdByName ? ` · ${v.createdByName}` : ''}
                  </span>
                </span>
                {v.live ? (
                  <span className="badge badge-ok">{t('versions.liveBadge')}</span>
                ) : (
                  canEdit && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-busy={busy === v.id || undefined} onClick={() => void restore(v)}>
                      {t('versions.restore')}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ag-block" aria-labelledby="ag-versions-history">
        <h3 id="ag-versions-history" className="ui-section-title">
          {t('versions.history')}
        </h3>
        {changes.length === 0 ? (
          <p className="ag-quiet">{t('versions.historyEmpty')}</p>
        ) : (
          <ol className="ag-rows ag-changes">
            {changes.map((c) => (
              <li key={c.id} className="ag-change">
                <span className="ag-change-text">{describe(c)}</span>
                <span className="ui-help">
                  {c.personName ?? t('versions.someone')} · <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
