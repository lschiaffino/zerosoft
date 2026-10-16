'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { AGENT_TEMPLATE_KEYS, AGENT_TEMPLATES, type AgentListItem, type AgentTemplateKey } from '@/lib/agents-config';
import { api, errorText, toolName } from './agents-ui';

interface Props {
  agents: AgentListItem[];
  canEdit: boolean;
  aiEnabled: boolean;
}

/** Lista de agentes + plantillas (/app/agents). */
export default function AgentsHome({ agents: initial, canEdit, aiEnabled }: Props) {
  const t = useTranslations('agents');
  const router = useRouter();
  const [agents, setAgents] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const autoCreated = useRef(false);

  async function create(key: string, template?: AgentTemplateKey) {
    setBusy(key);
    setError(null);
    const body = template
      ? {
          name: t(`templates.${template}.name`),
          template,
          instructions: t(`templates.${template}.instructions`),
          welcomeMessage: t(`templates.${template}.welcome`),
        }
      : { name: t('editor.untitled') };
    const res = await api<{ id?: string }>('/api/agents', { method: 'POST', body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok || !res.data.id) {
      setError(errorText(t, res.data.error));
      return;
    }
    router.push(`/app/agents/${res.data.id}`);
  }

  // ?new=1 (sidebar / ⌘K): crea uno vacío y abre el editor (igual que Robots).
  useEffect(() => {
    if (params.get('new') === '1' && canEdit && !autoCreated.current) {
      autoCreated.current = true;
      // Saca ?new=1 de la URL: volver atrás no debe crear otro.
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      window.history.replaceState(window.history.state, '', url);
      void create('new');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canEdit]);

  async function toggle(id: string, enabled: boolean) {
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, enabled } : a)));
    const res = await api(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    if (!res.ok) {
      setAgents((list) => list.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)));
      setError(errorText(t, res.data.error));
    }
  }

  function feedback(a: AgentListItem): string {
    const total = a.thumbsUp + a.thumbsDown;
    if (!total) return '—';
    return `${Math.round((a.thumbsUp / total) * 100)}% · ${total}`;
  }

  return (
    <div className="app-page ag-home">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('title')}</h1>
          <p className="muted ag-sub">{t('subtitle')}</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-solid" disabled={busy !== null} onClick={() => create('new')}>
            {t('list.new')}
          </button>
        )}
      </div>
      {!aiEnabled && (
        <div className="ag-banner" role="note">
          <strong>{t('aiOff.title')}</strong>
          <span>{t('aiOff.body')}</span>
        </div>
      )}
      {!canEdit && <p className="muted ag-note">{t('list.adminOnly')}</p>}
      {error && (
        <p className="ag-error" role="alert">
          {error}
        </p>
      )}

      <section className="ag-section" aria-labelledby="ag-list-title">
        <h2 id="ag-list-title" className="ag-section-title">
          {t('list.title')}
        </h2>
        {agents.length === 0 ? (
          <div className="ag-empty">
            <p>{t('list.empty')}</p>
            <p className="muted">{t('list.emptyHint')}</p>
          </div>
        ) : (
          <div className="ag-table" role="table">
            <div className="ag-row ag-row-head" role="row">
              <span role="columnheader">{t('list.name')}</span>
              <span role="columnheader">{t('list.channels')}</span>
              <span role="columnheader" className="ag-num">
                {t('list.conversations7d')}
              </span>
              <span role="columnheader" className="ag-num">
                {t('list.feedback')}
              </span>
              <span role="columnheader">{t('list.status')}</span>
            </div>
            {agents.map((a) => (
              <div className="ag-row" role="row" key={a.id}>
                <span role="cell" className="ag-row-name">
                  <span className="ag-avatar" aria-hidden="true">
                    {a.emoji || a.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="ag-row-title">
                    <Link href={`/app/agents/${a.id}`}>{a.name}</Link>
                    <span className="muted">
                      {a.tools.enabled.length
                        ? a.tools.enabled.map((k) => toolName(t, k)).join(' · ')
                        : t('list.noTools')}
                    </span>
                  </span>
                </span>
                <span role="cell" className="ag-row-channels">
                  {a.channels.length ? a.channels.map((c) => t(`channelNames.${c}`)).join(' · ') : <span className="muted">{t('list.noChannels')}</span>}
                </span>
                <span role="cell" className="ag-num mono">
                  {a.conversations7d}
                </span>
                <span role="cell" className="ag-num mono">
                  {feedback(a)}
                </span>
                <span role="cell">
                  <label className="ag-switch">
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      disabled={!canEdit}
                      onChange={(e) => toggle(a.id, e.target.checked)}
                      aria-label={`${a.name}: ${a.enabled ? t('list.enabled') : t('list.disabled')}`}
                    />
                    <span className="ag-switch-track" aria-hidden="true" />
                    <span className="ag-switch-label">{a.enabled ? t('list.enabled') : t('list.disabled')}</span>
                  </label>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ag-section" aria-labelledby="ag-templates-title">
        <h2 id="ag-templates-title" className="ag-section-title">
          {t('templates.title')}
        </h2>
        <p className="muted ag-section-sub">{t('templates.subtitle')}</p>
        <div className="ag-templates">
          {AGENT_TEMPLATE_KEYS.map((key) => (
            <article className="ag-template" key={key}>
              <span className="ag-avatar" aria-hidden="true">
                {AGENT_TEMPLATES[key].emoji}
              </span>
              <h3>{t(`templates.${key}.name`)}</h3>
              <p className="muted">{t(`templates.${key}.desc`)}</p>
              <p className="ag-template-tools mono">{AGENT_TEMPLATES[key].tools.map((k) => toolName(t, k)).join(' · ')}</p>
              {canEdit && (
                <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => create(key, key)}>
                  {busy === key ? t('editor.saving') : t('templates.use')}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
