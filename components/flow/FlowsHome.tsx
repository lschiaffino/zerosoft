'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { FlowListItem } from '@/lib/flow';
import { FLOW_TEMPLATES, triggerNode } from '@/lib/flow-schema';
import { i18nKey, RUN_BADGE } from './flow-ui';

interface Props {
  flows: FlowListItem[];
  canEdit: boolean;
}

/** Lista de flows + plantillas (/app/flow). */
export default function FlowsHome({ flows: initial, canEdit }: Props) {
  const t = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const router = useRouter();
  const [flows, setFlows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const autoCreated = useRef(false);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !data?.id) {
      setBusy(null);
      setError(t.has(`errors.${data?.error}`) ? t(`errors.${data?.error}`) : t('errors.generic'));
      return;
    }
    router.push(`/app/flow/${data.id}`);
  }

  // ?new=1 (sidebar / ⌘K): crea uno vacío y abre el editor (igual que Robots).
  useEffect(() => {
    if (params.get('new') === '1' && canEdit && !autoCreated.current) {
      autoCreated.current = true;
      // Saca ?new=1 de la URL: volver atrás no debe crear otro.
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      window.history.replaceState(window.history.state, '', url);
      void create({ name: t('editor.untitled') }, 'new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canEdit]);

  async function toggle(id: string, enabled: boolean) {
    setFlows((list) => list.map((f) => (f.id === id ? { ...f, enabled } : f)));
    const res = await fetch(`/api/flow/flows/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    if (!res?.ok) {
      setFlows((list) => list.map((f) => (f.id === id ? { ...f, enabled: !enabled } : f)));
      setError(t('errors.generic'));
    }
  }

  function triggerLabel(f: FlowListItem): string {
    const trig = triggerNode(f.graph);
    if (!trig) return '';
    const base = t(`nodes.${i18nKey(trig.type)}.title`);
    if (trig.type === 'trigger.event' && f.triggerEvent) return `${base} · ${t(`events.${i18nKey(f.triggerEvent)}`)}`;
    return base;
  }

  const createButton = canEdit ? (
    <button
      type="button"
      className="btn btn-primary"
      aria-busy={busy === 'new' || undefined}
      disabled={busy !== null && busy !== 'new'}
      onClick={() => create({ name: t('editor.untitled') }, 'new')}
    >
      {t('list.new')}
    </button>
  ) : null;

  return (
    <div className="ui-page flow-page">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={flows.length > 0 ? createButton : undefined}
      />
      {!canEdit && <p className="ui-help">{t('list.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <section className="flow-block" aria-label={t('list.title')}>
        <DataTable
          caption={t('list.title')}
          className="flow-table flow-table-flows"
          rows={flows}
          rowKey={(f) => f.id}
          rowHref={(f) => `/app/flow/${f.id}`}
          empty={
            <EmptyState
              product="flow"
              title={t('list.emptyTitle')}
              body={t('list.emptyHint')}
              action={createButton}
              secondary={<a href="#flow-templates">{t('list.emptyTemplates')}</a>}
            />
          }
          columns={[
            {
              key: 'name',
              header: t('list.name'),
              cell: (f) => (
                <span className="flow-name-cell">
                  <span className="flow-ellipsis">{f.name}</span>
                </span>
              ),
            },
            { key: 'trigger', header: t('list.trigger'), cell: (f) => <span className="flow-ellipsis">{triggerLabel(f)}</span> },
            {
              key: 'last',
              header: t('list.lastRun'),
              cell: (f) =>
                f.lastRun ? (
                  <span className="flow-last-run">
                    <span className={`badge ${RUN_BADGE[f.lastRun.status] ?? ''}`}>{t(`runs.status.${f.lastRun.status}`)}</span>
                    <span className="flow-muted" suppressHydrationWarning>
                      {format.relativeTime(new Date(f.lastRun.createdAt), now)}
                    </span>
                  </span>
                ) : (
                  <span className="flow-muted">{t('list.never')}</span>
                ),
            },
            {
              key: 'enabled',
              header: t('list.status'),
              width: '120px',
              cell: (f) => (
                <label className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={f.enabled}
                    disabled={!canEdit}
                    onChange={(e) => void toggle(f.id, e.target.checked)}
                    aria-label={`${f.name}: ${t('editor.enabled')}`}
                  />
                  <span className="flow-muted">{f.enabled ? t('editor.enabled') : t('editor.disabled')}</span>
                </label>
              ),
            },
          ]}
        />
      </section>

      <section className="flow-block" id="flow-templates" aria-labelledby="flow-templates-title">
        <div className="flow-block-head">
          <h2 id="flow-templates-title" className="flow-block-title">
            {t('templates.title')}
          </h2>
          <p className="ui-help">{t('templates.subtitle')}</p>
        </div>
        <ul className="flow-templates">
          {FLOW_TEMPLATES.map((tpl) => (
            <li className="flow-template" key={tpl.key}>
              <div className="flow-template-text">
                <h3 className="flow-template-name">{t(`templates.items.${tpl.key}.name`)}</h3>
                <p className="flow-template-desc">{t(`templates.items.${tpl.key}.desc`)}</p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-busy={busy === tpl.key || undefined}
                  disabled={busy !== null && busy !== tpl.key}
                  aria-label={`${t('templates.use')}: ${t(`templates.items.${tpl.key}.name`)}`}
                  onClick={() => create({ name: t(`templates.items.${tpl.key}.name`), template: tpl.key }, tpl.key)}
                >
                  {t('templates.use')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
