'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { FlowListItem } from '@/lib/flow';
import { FLOW_TEMPLATES, NODE_DEFS, triggerNode, type FlowNodeType } from '@/lib/flow-schema';
import { CATEGORY_COLOR, i18nKey } from './flow-ui';

interface Props {
  flows: FlowListItem[];
  canEdit: boolean;
}

/** Lista de flows + galería de plantillas (/app/flow). */
export default function FlowsHome({ flows: initial, canEdit }: Props) {
  const t = useTranslations('flow');
  const format = useFormatter();
  const router = useRouter();
  const [flows, setFlows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch('/api/flow/flows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.id) {
      setError(t.has(`errors.${data?.error}`) ? t(`errors.${data?.error}`) : t('errors.generic'));
      return;
    }
    router.push(`/app/flow/${data.id}`);
  }

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
    if (!trig) return '—';
    const base = t(`nodes.${i18nKey(trig.type)}.title`);
    if (trig.type === 'trigger.event' && f.triggerEvent) return `${base} · ${t(`events.${i18nKey(f.triggerEvent)}`)}`;
    return base;
  }

  return (
    <div className="app-page flow-home">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="muted flow-sub">{t('subtitle')}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="btn btn-solid"
            disabled={busy !== null}
            onClick={() => create({ name: t('editor.untitled') }, 'new')}
          >
            {t('list.new')}
          </button>
        )}
      </div>
      {!canEdit && <p className="muted flow-note">{t('list.adminOnly')}</p>}
      {error && (
        <p className="flow-error" role="alert">
          {error}
        </p>
      )}

      <section className="flow-section" aria-labelledby="flow-list-title">
        <h2 id="flow-list-title" className="flow-section-title">
          {t('list.title')}
        </h2>
        {flows.length === 0 ? (
          <div className="flow-empty">
            <p>{t('list.empty')}</p>
            <p className="muted">{t('list.emptyHint')}</p>
          </div>
        ) : (
          <div className="flow-table" role="table">
            <div className="flow-row flow-row-head" role="row">
              <span role="columnheader">{t('list.name')}</span>
              <span role="columnheader">{t('list.trigger')}</span>
              <span role="columnheader">{t('list.lastRun')}</span>
              <span role="columnheader">{t('list.status')}</span>
            </div>
            {flows.map((f) => (
              <div className="flow-row" role="row" key={f.id}>
                <span role="cell" className="flow-row-name">
                  <Link href={`/app/flow/${f.id}`}>{f.name}</Link>
                  {f.description && <span className="muted">{f.description}</span>}
                </span>
                <span role="cell" className="flow-row-trigger">
                  {triggerLabel(f)}
                </span>
                <span role="cell" className="flow-row-last">
                  {f.lastRun ? (
                    <>
                      <span className={`flow-dot is-${f.lastRun.status}`} aria-hidden="true" />
                      {t(`runs.status.${f.lastRun.status}`)}
                      <span className="muted"> · {format.relativeTime(new Date(f.lastRun.createdAt))}</span>
                    </>
                  ) : (
                    <span className="muted">{t('list.never')}</span>
                  )}
                </span>
                <span role="cell">
                  <label className="flow-switch" title={f.enabled ? t('editor.enabled') : t('editor.disabled')}>
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      disabled={!canEdit}
                      onChange={(e) => toggle(f.id, e.target.checked)}
                      aria-label={`${f.name}: ${f.enabled ? t('editor.enabled') : t('editor.disabled')}`}
                    />
                    <span className="flow-switch-track" aria-hidden="true" />
                    <span className="flow-switch-label">{f.enabled ? t('editor.enabled') : t('editor.disabled')}</span>
                  </label>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flow-section" aria-labelledby="flow-templates-title">
        <h2 id="flow-templates-title" className="flow-section-title">
          {t('templates.title')}
        </h2>
        <p className="muted flow-section-sub">{t('templates.subtitle')}</p>
        <div className="flow-templates">
          {FLOW_TEMPLATES.map((tpl) => (
            <article className="flow-template" key={tpl.key}>
              <div className="flow-template-chain" aria-hidden="true">
                {tpl.graph.nodes.map((n) => (
                  <span
                    key={n.id}
                    className="flow-template-step"
                    style={{ background: CATEGORY_COLOR[NODE_DEFS[n.type as FlowNodeType].category] }}
                  />
                ))}
              </div>
              <h3>{t(`templates.items.${tpl.key}.name`)}</h3>
              <p className="muted">{t(`templates.items.${tpl.key}.desc`)}</p>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy !== null}
                  onClick={() => create({ name: t(`templates.items.${tpl.key}.name`), template: tpl.key }, tpl.key)}
                >
                  {busy === tpl.key ? t('editor.saving') : t('templates.use')}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
