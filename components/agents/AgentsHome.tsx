'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { AGENT_TEMPLATE_KEYS, AGENT_TEMPLATES, type AgentListItem, type AgentTemplateKey } from '@/lib/agents-config';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import DataTable from '@/components/ui/DataTable';
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
    if (!res.ok || !res.data.id) {
      setBusy(null);
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
    if (!total) return t('list.noFeedback');
    return `${Math.round((a.thumbsUp / total) * 100)}% · ${total}`;
  }

  const createButton = canEdit ? (
    <button
      type="button"
      className="btn btn-primary"
      disabled={busy !== null}
      aria-busy={busy === 'new' || undefined}
      onClick={() => create('new')}
    >
      {t('list.new')}
    </button>
  ) : null;

  return (
    <div className="app-page ui-page ag-home">
      <PageHeader title={t('title')} description={t('subtitle')} actions={createButton} />

      {!aiEnabled && (
        <div className="panel panel-quiet ag-note" role="note">
          <strong>{t('aiOff.title')}</strong> {t('aiOff.body')}
        </div>
      )}
      {!canEdit && <p className="ui-help">{t('list.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      {agents.length === 0 ? (
        <EmptyState
          product="agents"
          title={t('list.empty')}
          body={t('list.emptyHint')}
          action={createButton ?? undefined}
          secondary={canEdit ? t('list.emptyAlt') : undefined}
        />
      ) : (
        <DataTable
          caption={t('list.title')}
          rows={agents}
          rowKey={(a) => a.id}
          rowHref={(a) => `/app/agents/${a.id}`}
          columns={[
            { key: 'name', header: t('list.name'), cell: (a) => a.name },
            {
              key: 'tools',
              header: t('tabs.tools'),
              cell: (a) => (
                <span className="ag-cell-clip">
                  {a.tools.enabled.length ? a.tools.enabled.map((k) => toolName(t, k)).join(', ') : t('list.noTools')}
                </span>
              ),
            },
            {
              key: 'channels',
              header: t('list.channels'),
              cell: (a) =>
                a.channels.length ? (
                  a.channels.map((c) => t(`channelNames.${c}`)).join(', ')
                ) : (
                  <span className="ag-quiet">{t('list.noChannels')}</span>
                ),
            },
            { key: 'c7', header: t('list.conversations7d'), cell: (a) => a.conversations7d, numeric: true, width: '120px' },
            { key: 'fb', header: t('list.feedback'), cell: (a) => feedback(a), numeric: true, width: '130px' },
            {
              key: 'status',
              header: t('list.status'),
              width: '120px',
              cell: (a) => (
                <label className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={a.enabled}
                    disabled={!canEdit}
                    onChange={(e) => toggle(a.id, e.target.checked)}
                    aria-label={t('list.toggle', { name: a.name })}
                  />
                  <span>{a.enabled ? t('list.enabled') : t('list.disabled')}</span>
                </label>
              ),
            },
          ]}
        />
      )}

      <section className="ag-block" aria-labelledby="ag-templates-title">
        <div className="ui-section-head">
          <h2 id="ag-templates-title" className="ui-section-title">
            {t('templates.title')}
          </h2>
          <p className="ui-section-desc">{t('templates.subtitle')}</p>
        </div>
        <ul className="ag-templates">
          {AGENT_TEMPLATE_KEYS.map((key) => (
            <li className="ag-template" key={key}>
              <div className="ag-template-text">
                <h3 className="ag-template-name">{t(`templates.${key}.name`)}</h3>
                <p className="ag-template-desc">{t(`templates.${key}.desc`)}</p>
                <p className="ui-help">
                  {t('templates.tools', { tools: AGENT_TEMPLATES[key].tools.map((k) => toolName(t, k)).join(', ') })}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  aria-busy={busy === key || undefined}
                  onClick={() => create(key, key)}
                >
                  {busy === key ? t('templates.creating') : t('templates.use')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
