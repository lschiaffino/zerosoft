'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AgentMcpServerDto } from '@/lib/agents-mcp';
import { parseDbUtc } from '@/lib/utils';
import { useConfirm } from './useConfirm';
import { api, errorText } from './agents-ui';

/**
 * Servidores MCP del agente: conectar (URL + header de auth opcional), elegir
 * qué herramientas usa, volver a leer la lista, cambiar el token y sacarlo.
 * El valor del token nunca vuelve del servidor.
 */
export default function AgentMcp({
  agentId,
  servers: initial,
  readOnly,
}: {
  agentId: string;
  servers: AgentMcpServerDto[];
  readOnly: boolean;
}) {
  const t = useTranslations('agents');
  const [confirmNode, ask] = useConfirm();
  const format = useFormatter();
  const [servers, setServers] = useState(initial);
  const [form, setForm] = useState({ name: '', url: '', headerName: 'Authorization', headerValue: '' });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState('');

  async function add() {
    if (!form.url.trim() || adding) return;
    setAdding(true);
    setError(null);
    const res = await api<{ servers?: AgentMcpServerDto[] }>(`/api/agents/${agentId}/mcp`, {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        url: form.url.trim(),
        ...(form.headerValue ? { headerName: form.headerName.trim() || 'Authorization', headerValue: form.headerValue } : {}),
      }),
    });
    setAdding(false);
    if (!res.ok || !res.data.servers) {
      setError(errorText(t, res.data.error));
      return;
    }
    setServers(res.data.servers);
    setForm({ name: '', url: '', headerName: 'Authorization', headerValue: '' });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await api<{ servers?: AgentMcpServerDto[] }>(`/api/agents/${agentId}/mcp/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok || !res.data.servers) {
      setError(errorText(t, res.data.error));
      return false;
    }
    setServers(res.data.servers);
    return true;
  }

  async function remove(s: AgentMcpServerDto) {
    if (!(await ask({ title: t('mcp.removeConfirm', { name: s.name }), confirmLabel: t('mcp.remove'), danger: true }))) return;
    setBusy(s.id);
    const res = await api<{ servers?: AgentMcpServerDto[] }>(`/api/agents/${agentId}/mcp/${s.id}`, { method: 'DELETE' });
    setBusy(null);
    if (res.ok && res.data.servers) setServers(res.data.servers);
    else setError(errorText(t, res.data.error));
  }

  return (
    <div className="ag-mcp">
      {confirmNode}
      {servers.length === 0 ? (
        <p className="ui-help">{t('mcp.empty')}</p>
      ) : (
        <ul className="ag-rows" aria-label={t('mcp.title')}>
          {servers.map((s) => (
            <li key={s.id} className="ag-mcp-server">
              <div className="ag-mcp-head">
                <div className="ag-url-main">
                  <span className="ag-url-title">{s.name}</span>
                  <span className="ui-help data">{s.url}</span>
                  <span className="ui-help">
                    {s.status === 'ok' ? t('mcp.toolsCount', { count: s.tools.length }) : errorText(t, s.error)} ·{' '}
                    {s.hasAuth ? t('mcp.authSet', { header: s.headerName }) : t('mcp.noAuth')} ·{' '}
                    <time dateTime={s.refreshedAt}>{format.dateTime(parseDbUtc(s.refreshedAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>
                  </span>
                </div>
                <span className={`badge${s.status === 'ok' ? ' badge-ok' : ' badge-bad'}`}>{t(`mcp.status.${s.status}`)}</span>
              </div>
              {s.tools.length > 0 && (
                <fieldset className="ag-mcp-tools" disabled={readOnly || busy === s.id}>
                  <legend className="label">{t('mcp.tools')}</legend>
                  {s.tools.map((tool) => (
                    <label key={tool.name} className="ui-check ag-mcp-tool">
                      <input
                        type="checkbox"
                        checked={s.allowed.includes(tool.name)}
                        onChange={(e) =>
                          void patch(s.id, {
                            allowed: e.target.checked ? [...s.allowed, tool.name] : s.allowed.filter((n) => n !== tool.name),
                          })
                        }
                      />
                      <span className="data">{tool.name}</span>
                      <span className={`badge${tool.readOnly ? '' : ' badge-warn'}`}>{tool.readOnly ? t('mcp.readOnly') : t('mcp.writes')}</span>
                      {tool.description && <span className="ui-help ag-mcp-desc">{tool.description}</span>}
                    </label>
                  ))}
                </fieldset>
              )}
              {!readOnly && (
                <div className="ag-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-busy={busy === s.id || undefined} onClick={() => void patch(s.id, { refresh: true })}>
                    {t('mcp.refresh')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setTokenFor(tokenFor === s.id ? null : s.id);
                      setToken('');
                    }}
                  >
                    {t('mcp.changeToken')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-label={`${t('mcp.remove')}: ${s.name}`} onClick={() => void remove(s)}>
                    {t('mcp.remove')}
                  </button>
                </div>
              )}
              {tokenFor === s.id && (
                <form
                  className="ag-add-row"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await patch(s.id, { headerValue: token || null })) setTokenFor(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setTokenFor(null);
                  }}
                >
                  <div className="ui-field">
                    <label className="sr-only" htmlFor={`ag-mcp-token-${s.id}`}>
                      {t('mcp.headerValue')}
                    </label>
                    <input
                      id={`ag-mcp-token-${s.id}`}
                      className="input data"
                      type="password"
                      autoComplete="off"
                      value={token}
                      autoFocus
                      placeholder={t('mcp.tokenPlaceholder')}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-secondary btn-sm">
                    {token ? t('mcp.saveToken') : t('mcp.clearToken')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <form
          className="ag-mcp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="ag-field-row">
            <div className="ui-field">
              <label className="label" htmlFor="ag-mcp-name">
                {t('mcp.name')}
              </label>
              <input id="ag-mcp-name" className="input" maxLength={60} value={form.name} placeholder="Zapier" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ag-mcp-url">
                {t('mcp.url')}
              </label>
              <input
                id="ag-mcp-url"
                className="input data"
                type="url"
                value={form.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
          </div>
          <div className="ag-field-row">
            <div className="ui-field">
              <label className="label" htmlFor="ag-mcp-header">
                {t('mcp.headerName')}
              </label>
              <input id="ag-mcp-header" className="input data" value={form.headerName} maxLength={64} onChange={(e) => setForm({ ...form, headerName: e.target.value })} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="ag-mcp-value">
                {t('mcp.headerValue')}
              </label>
              <input
                id="ag-mcp-value"
                className="input data"
                type="password"
                autoComplete="off"
                value={form.headerValue}
                placeholder="Bearer sk_…"
                onChange={(e) => setForm({ ...form, headerValue: e.target.value })}
              />
            </div>
          </div>
          <p className="ui-help">{t('mcp.headerHint')}</p>
          <div className="ag-form-actions">
            <button type="submit" className="btn btn-secondary btn-sm" disabled={!form.url.trim() || adding} aria-busy={adding || undefined}>
              {adding ? t('mcp.adding') : t('mcp.add')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
