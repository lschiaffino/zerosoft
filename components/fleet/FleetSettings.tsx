'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ConnectionDto, ConnectionKind } from '@/lib/fleet/types';
import type { TokenDto } from '@/lib/fleet/sessions';
import { Ago } from './ui';

export interface SettingsProps {
  connections: ConnectionDto[];
  tokens: TokenDto[];
  installUrl: string;
  /** Sección de Inbox, Lines y WhatsApp (la arma la página con lo que hay conectado). */
  linkSection?: ReactNode;
}

async function api<T>(url: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? 'error' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Ajustes de Fleet: agentes locales (token + instalador del hook), cuentas de GitHub y de Vercel, y el enlace con Inbox y Lines. */
export default function FleetSettings(props: SettingsProps) {
  const t = useTranslations('fleet');
  const [connections, setConnections] = useState(props.connections);
  return (
    <div className="app-page ui-page flt-page flt-settings" data-testid="fleet-settings">
      <PageHeader title={t('settings.title')} description={t('settings.desc')} />
      <AgentsSection initial={props.tokens} installUrl={props.installUrl} />
      <ConnectionsSection kind="github" connections={connections} onChange={setConnections} />
      <ConnectionsSection kind="vercel" connections={connections} onChange={setConnections} />
      {props.linkSection}
    </div>
  );
}

function errorText(t: ReturnType<typeof useTranslations>, code: string): string {
  const known = [
    'github_unauthorized',
    'github_forbidden',
    'github_rate_limited',
    'vercel_unauthorized',
    'vercel_forbidden',
    'vercel_rate_limited',
    'invalid_token',
    'too_many_connections',
    'too_many_tokens',
    'team_not_found',
    'repo_not_found',
    'rate_limited',
    'network',
  ];
  return known.includes(code) ? t(`errors.${code}`) : t('errors.generic');
}

// ---------- Agentes locales ----------

function AgentsSection({ initial, installUrl }: { initial: TokenDto[]; installUrl: string }) {
  const t = useTranslations('fleet');
  const [tokens, setTokens] = useState(initial);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ command: string } | null>(null);
  const [revoke, setRevoke] = useState<TokenDto | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await api<{ command: string; tokens: TokenDto[] }>('/api/fleet/tokens', 'POST', { label: label.trim() });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r.error));
    setTokens(r.data.tokens);
    setCreated({ command: r.data.command });
    setLabel('');
    setCopied(false);
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy(true);
    const r = await api<{ tokens: TokenDto[] }>(`/api/fleet/tokens/${revoke.id}`, 'DELETE');
    setBusy(false);
    setRevoke(null);
    if (r.ok) setTokens(r.data.tokens);
    else setError(errorText(t, r.error));
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="ui-section" id="agents" aria-labelledby="flt-agents-title" data-testid="fleet-agents-section">
      <div className="ui-section-body">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id="flt-agents-title">
            {t('settings.agentsTitle')}
          </h2>
          <p className="ui-section-desc">{t('settings.agentsDesc')}</p>
        </div>
        {tokens.length > 0 && (
          <ul className="flt-list" data-testid="fleet-tokens">
            {tokens.map((tk) => (
              <li key={tk.id} className="flt-list-row" data-testid="fleet-token">
                <div className="flt-row-main">
                  <span className="flt-row-title">{tk.label || t('settings.tokenNoName')}</span>
                  <span className="flt-row-sub">
                    <span className="flt-mono">zsf_…{tk.hint}</span>
                    {tk.lastUsedAt ? (
                      <span>
                        {t('settings.lastUsed')} <Ago iso={tk.lastUsedAt} />
                      </span>
                    ) : (
                      <span>{t('settings.neverUsed')}</span>
                    )}
                  </span>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoke(tk)}>
                  {t('settings.revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="flt-inline-form" onSubmit={create}>
          <label className="ui-field flt-grow">
            <span className="label">{t('settings.tokenLabel')}</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('settings.tokenPlaceholder')} maxLength={80} data-testid="fleet-token-label" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="fleet-token-create">
            {t('settings.createToken')}
          </button>
        </form>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {created && (
          <div className="flt-install" data-testid="fleet-install">
            <p className="flt-install-lead">{t('settings.installLead')}</p>
            <div className="flt-code-row">
              <code className="flt-code" data-testid="fleet-install-command">
                {created.command}
              </code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copy} data-testid="fleet-install-copy">
                {copied ? t('settings.copied') : t('settings.copy')}
              </button>
            </div>
            <p className="ui-help">{t('settings.installOnce')}</p>
          </div>
        )}
        <details className="flt-details">
          <summary>{t('settings.whatIsSent')}</summary>
          <ul className="flt-bullets">
            <li>{t('settings.sent1')}</li>
            <li>{t('settings.sent2')}</li>
            <li>{t('settings.sent3')}</li>
            <li>{t('settings.sent4')}</li>
          </ul>
          <p className="ui-help">{t('settings.replyHow')}</p>
          <p className="ui-help">
            {t('settings.uninstall')} <code className="flt-mono">curl -fsSL {installUrl} | sh -s -- --uninstall</code>
          </p>
        </details>
      </div>
      <ConfirmDialog
        open={Boolean(revoke)}
        title={t('settings.revokeTitle')}
        body={t('settings.revokeBody')}
        confirmLabel={t('settings.revoke')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={doRevoke}
        onCancel={() => setRevoke(null)}
      />
    </section>
  );
}

// ---------- GitHub y Vercel ----------

function ConnectionsSection({ kind, connections, onChange }: { kind: ConnectionKind; connections: ConnectionDto[]; onChange: (c: ConnectionDto[]) => void }) {
  const t = useTranslations('fleet');
  const mine = connections.filter((c) => c.kind === kind);
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState<Array<{ id: string; slug: string; name: string }> | null>(null);
  const [vercelUser, setVercelUser] = useState('');
  const [teamId, setTeamId] = useState('');
  const [remove, setRemove] = useState<ConnectionDto | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!token.trim()) return setError(t('errors.invalid_token'));
    setBusy(true);
    if (kind === 'vercel' && teams === null) {
      // Paso 1 en Vercel: validar el token y elegir la cuenta o el equipo.
      const r = await api<{ username: string; teams: Array<{ id: string; slug: string; name: string }> }>('/api/fleet/vercel-teams', 'POST', { token: token.trim() });
      setBusy(false);
      if (!r.ok) return setError(errorText(t, r.error));
      setVercelUser(r.data.username);
      setTeams(r.data.teams);
      setTeamId(r.data.teams[0]?.id ?? '');
      return;
    }
    const r = await api<{ connections: ConnectionDto[] }>('/api/fleet/connections', 'POST', { kind, token: token.trim(), label: label.trim() || undefined, teamId: kind === 'vercel' ? teamId : undefined });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r.error));
    onChange(r.data.connections);
    setToken('');
    setLabel('');
    setTeams(null);
  }

  async function doRemove() {
    if (!remove) return;
    setBusy(true);
    const r = await api('/api/fleet/connections/' + remove.id, 'DELETE');
    setBusy(false);
    if (r.ok) onChange(connections.filter((c) => c.id !== remove.id));
    else setError(errorText(t, r.error));
    setRemove(null);
  }

  return (
    <section className="ui-section" id={kind} aria-labelledby={`fl-${kind}-title`} data-testid={`fleet-${kind}-section`}>
      <div className="ui-section-body">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id={`fl-${kind}-title`}>
            {kind === 'github' ? 'GitHub' : 'Vercel'}
          </h2>
          <p className="ui-section-desc">{kind === 'github' ? t('settings.githubDesc') : t('settings.vercelDesc')}</p>
        </div>
        {mine.length > 0 && (
          <ul className="flt-list">
            {mine.map((c) => (
              <ConnectionRow key={c.id} c={c} onChange={(next) => onChange(connections.map((x) => (x.id === next.id ? next : x)))} onRemove={() => setRemove(c)} />
            ))}
          </ul>
        )}
        <form className="flt-connect" onSubmit={connect} data-testid={`fleet-connect-${kind}`}>
          <div className="flt-inline-form">
            <label className="ui-field flt-grow">
              <span className="label">{kind === 'github' ? t('settings.githubToken') : t('settings.vercelToken')}</span>
              <input
                className="input flt-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setTeams(null);
                }}
                placeholder={kind === 'github' ? 'github_pat_…' : ''}
                data-testid={`fleet-${kind}-token`}
              />
            </label>
            <label className="ui-field flt-label-field">
              <span className="label">{t('settings.accountLabel')}</span>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t('settings.accountLabelPlaceholder')} />
            </label>
          </div>
          {kind === 'vercel' && teams !== null && (
            <label className="ui-field">
              <span className="label">{t('settings.vercelScope')}</span>
              <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="fleet-vercel-team">
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
                <option value="">{t('settings.vercelPersonal', { user: vercelUser })}</option>
              </select>
            </label>
          )}
          <p className="ui-help">{kind === 'github' ? t('settings.githubHelp') : t('settings.vercelHelp')}</p>
          <div className="flt-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy} data-testid={`fleet-${kind}-connect`}>
              {kind === 'vercel' && teams === null ? t('settings.checkToken') : mine.length ? t('settings.connectAnother') : kind === 'github' ? t('settings.connectGithub') : t('settings.connectVercel')}
            </button>
          </div>
          {error && (
            <p className="ui-error" role="alert" data-testid={`fleet-${kind}-error`}>
              {error}
            </p>
          )}
        </form>
      </div>
      <ConfirmDialog
        open={Boolean(remove)}
        title={t('settings.disconnectTitle', { name: remove?.label ?? '' })}
        body={t('settings.disconnectBody')}
        confirmLabel={t('settings.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={doRemove}
        onCancel={() => setRemove(null)}
      />
    </section>
  );
}

function ConnectionRow({ c, onChange, onRemove }: { c: ConnectionDto; onChange: (c: ConnectionDto) => void; onRemove: () => void }) {
  const t = useTranslations('fleet');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; name: string; private?: boolean }> | null>(null);
  const [selected, setSelected] = useState<string[]>(c.selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.label);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setSelected(c.selected);
    if (options) return;
    const r = await api<{ options: Array<{ id: string; name: string; private?: boolean }> }>(`/api/fleet/connections/${c.id}/options`, 'GET');
    if (r.ok) setOptions(r.data.options);
    else setError(errorText(t, r.error));
  }

  async function save() {
    setBusy(true);
    const r = await api<{ connection: ConnectionDto }>(`/api/fleet/connections/${c.id}`, 'PATCH', { selected });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r.error));
    onChange(r.data.connection);
    setOpen(false);
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    const r = await api<{ connection: ConnectionDto }>(`/api/fleet/connections/${c.id}`, 'PATCH', { label: name });
    if (r.ok) onChange(r.data.connection);
    setEditing(false);
  }

  const max = c.kind === 'github' ? 15 : 50;
  return (
    <li className="flt-list-row flt-conn" data-testid="fleet-connection" data-kind={c.kind}>
      <div className="flt-row-main">
        {editing ? (
          <form onSubmit={rename} className="flt-rename">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('settings.accountLabel')}
              autoFocus
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setName(c.label);
                  setEditing(false);
                }
              }}
            />
          </form>
        ) : (
          <span className="flt-row-title">{c.label}</span>
        )}
        <span className="flt-row-sub">
          {c.account !== c.label && <span>{c.account}</span>}
          <span className="flt-mono">…{c.tokenHint}</span>
          <span>{c.kind === 'github' ? t('settings.reposCount', { n: c.selected.length }) : c.selected.length ? t('settings.projectsCount', { n: c.selected.length }) : t('settings.allProjects')}</span>
          {c.status === 'error' ? (
            <span className="flt-bad" data-testid="fleet-connection-error">
              {errorText(t, c.error.split(':').pop()?.trim() || c.error)}
            </span>
          ) : (
            c.lastSyncAt && (
              <span>
                {t('sync.last')} <Ago iso={c.lastSyncAt} />
              </span>
            )
          )}
        </span>
      </div>
      <div className="flt-row-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} aria-expanded={open} data-testid="fleet-connection-pick">
          {c.kind === 'github' ? t('settings.repos') : t('settings.projects')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          {t('settings.rename')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} data-testid="fleet-connection-remove">
          {t('settings.disconnect')}
        </button>
      </div>
      {open && (
        <div className="flt-picker" data-testid="fleet-picker">
          {!options ? (
            error ? (
              <p className="ui-error">{error}</p>
            ) : (
              <p className="flt-meta" role="status">
                {t('settings.loading')}
              </p>
            )
          ) : (
            <>
              <p className="ui-help">{c.kind === 'github' ? t('settings.pickRepos', { max }) : t('settings.pickProjects')}</p>
              <ul className="flt-checks-list">
                {options.map((o) => {
                  const on = selected.includes(o.id);
                  return (
                    <li key={o.id}>
                      <label className="flt-check">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && selected.length >= max}
                          onChange={() => setSelected(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])}
                        />
                        <span className="flt-mono">{o.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flt-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy} data-testid="fleet-picker-save">
                  {t('settings.save')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </button>
              </div>
              {error && <p className="ui-error">{error}</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}
