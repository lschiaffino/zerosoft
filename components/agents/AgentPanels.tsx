'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AGENT_VOICE_LANGUAGES, type AgentSettingsConfig } from '@/lib/agents-config';
import type { AgentIntegrationsDto } from '@/lib/agents-integrations';
import type { AgentSourceDto } from '@/lib/agents-sources';
import type { AgentAbResults } from '@/lib/agents-ab';
import type { AgentVersionDto } from '@/lib/agents-versions';
import { parseDbUtc } from '@/lib/utils';
import FormSection from '@/components/ui/FormSection';
import { api, errorText } from './agents-ui';
import { useConfirm } from './useConfirm';

type Kind = 'stripe' | 'shopify' | 'slack' | 'meta';

interface ChannelsDto {
  email: { inboundConfigured: boolean; widgets: Array<{ id: string; name: string; address: string | null }> };
  whatsapp: { groupsAccess: boolean; numbers: number; isDefault: boolean; otherDefault: boolean; assignedChats: number };
  voice: { configured: boolean; number: string | null; numbers: string[]; webhookUrl: string };
  slack: { connected: boolean; eventsUrl: string };
  meta: { connected: boolean; pageName: string | null; webhookUrl: string; verifyToken: string | null };
}

interface AccessDto {
  members: 'viewer' | 'none';
  people: Array<{ id: string; name: string; email: string; role: string; hasApp: boolean; assigned: 'editor' | 'viewer' | 'none' | null; level: 'edit' | 'view' | 'none' }>;
}

function Copyable({ value, label }: { value: string; label: string }) {
  const t = useTranslations('agents');
  const [copied, setCopied] = useState(false);
  return (
    <div className="ag-kv">
      <span className="label">{label}</span>
      <div className="ag-access-row">
        <code className="ag-copyable data">{value}</code>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
        >
          <span aria-live="polite">{copied ? t('channels.copied') : t('channels.copy')}</span>
        </button>
      </div>
    </div>
  );
}

// ---------- Conexiones (Stripe, Shopify, Slack, Meta) ----------

const FIELDS: Record<Kind, Array<{ key: string; secret: boolean; placeholder: string }>> = {
  stripe: [{ key: 'key', secret: true, placeholder: 'rk_live_…' }],
  shopify: [
    { key: 'shop', secret: false, placeholder: 'mystore.myshopify.com' },
    { key: 'token', secret: true, placeholder: 'shpat_…' },
  ],
  slack: [
    { key: 'botToken', secret: true, placeholder: 'xoxb-…' },
    { key: 'signingSecret', secret: true, placeholder: '8f3c…' },
  ],
  meta: [
    { key: 'pageToken', secret: true, placeholder: 'EAAB…' },
    { key: 'appSecret', secret: true, placeholder: 'a1b2…' },
  ],
};

export function IntegrationsPanel({
  agentId,
  kinds,
  isAdmin,
  onChange,
}: {
  agentId: string;
  kinds: Kind[];
  isAdmin: boolean;
  onChange?: (i: AgentIntegrationsDto) => void;
}) {
  const t = useTranslations('agents');
  const [data, setData] = useState<AgentIntegrationsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Kind | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmNode, ask] = useConfirm();

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void api<{ integrations?: AgentIntegrationsDto }>(`/api/agents/${agentId}/integrations`).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data.integrations) setData(res.data.integrations);
      else setError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, isAdmin, t]);

  if (!isAdmin) return <p className="ui-help">{t('integrations.adminsOnly')}</p>;

  async function connect(e: FormEvent, kind: Kind) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ integrations?: AgentIntegrationsDto }>(`/api/agents/${agentId}/integrations`, {
      method: 'POST',
      body: JSON.stringify({ kind, ...values }),
    });
    setBusy(false);
    if (!res.ok || !res.data.integrations) {
      setError(errorText(t, res.data.error));
      return;
    }
    setData(res.data.integrations);
    onChange?.(res.data.integrations);
    setOpen(null);
    setValues({});
  }

  async function disconnect(kind: Kind) {
    if (!(await ask({ title: t('integrations.disconnectConfirm', { name: t(`integrations.names.${kind}`) }), confirmLabel: t('integrations.disconnect'), danger: true }))) return;
    const res = await api<{ integrations?: AgentIntegrationsDto }>(`/api/agents/${agentId}/integrations?kind=${kind}`, { method: 'DELETE' });
    if (res.ok && res.data.integrations) {
      setData(res.data.integrations);
      onChange?.(res.data.integrations);
    } else setError(errorText(t, res.data.error));
  }

  const summary = (kind: Kind): string => {
    if (!data) return '';
    if (kind === 'stripe') return data.stripe.connected ? t('integrations.stripeOn', { mode: data.stripe.mode ?? '', last4: data.stripe.last4 ?? '' }) : '';
    if (kind === 'shopify') return data.shopify.connected ? (data.shopify.shop ?? '') : '';
    if (kind === 'slack') return data.slack.connected ? t('integrations.slackOn', { last4: data.slack.last4 ?? '' }) : '';
    return data.meta.connected ? (data.meta.pageName ?? t('integrations.on')) : '';
  };
  const connected = (kind: Kind) => Boolean(data && data[kind].connected);

  return (
    <div className="ag-connect">
      {confirmNode}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {data === null && !error ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : (
        <ul className="ag-rows">
          {kinds.map((kind) => (
            <li key={kind} className="ag-mcp-server" data-testid={`ag-integration-${kind}`}>
              <div className="ag-access-row">
                <span className="ag-access-name">
                  <strong>{t(`integrations.names.${kind}`)}</strong> <span className="ui-help">{summary(kind)}</span>
                </span>
                <span className={`badge${connected(kind) ? ' badge-ok' : ''}`}>{connected(kind) ? t('integrations.on') : t('integrations.off')}</span>
                {connected(kind) ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void disconnect(kind)}>
                    {t('integrations.disconnect')}
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" aria-expanded={open === kind} onClick={() => setOpen(open === kind ? null : kind)}>
                    {t('integrations.connect')}
                  </button>
                )}
              </div>
              <p className="ui-help">{t(`integrations.hints.${kind}`)}</p>
              {open === kind && (
                <form className="ag-connect" onSubmit={(e) => void connect(e, kind)}>
                  {FIELDS[kind].map((f) => (
                    <div key={f.key} className="ui-field">
                      <label className="label" htmlFor={`ag-int-${kind}-${f.key}`}>
                        {t(`integrations.fields.${f.key}` as never)}
                      </label>
                      <input
                        id={`ag-int-${kind}-${f.key}`}
                        className="input data"
                        type={f.secret ? 'password' : 'text'}
                        autoComplete="off"
                        spellCheck={false}
                        required
                        placeholder={f.placeholder}
                        value={values[f.key] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setOpen(null);
                        }}
                      />
                    </div>
                  ))}
                  <div className="ag-access-row">
                    <button type="submit" className="btn btn-primary btn-sm" aria-busy={busy || undefined} disabled={busy}>
                      {busy ? t('integrations.testing') : t('integrations.save')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
                      {t('qa.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Canales externos ----------

export function ChannelsPanel({
  agentId,
  isAdmin,
  readOnly,
  settings,
  onSettings,
}: {
  agentId: string;
  isAdmin: boolean;
  readOnly: boolean;
  settings: AgentSettingsConfig;
  onSettings: (s: AgentSettingsConfig) => void;
}) {
  const t = useTranslations('agents');
  const [data, setData] = useState<ChannelsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ channels?: ChannelsDto }>(`/api/agents/${agentId}/channels`);
    if (res.ok && res.data.channels) {
      setData(res.data.channels);
      setNumber(res.data.channels.voice.number ?? '');
    } else setError(errorText(t, res.data.error));
  }, [agentId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await api<{ channels?: ChannelsDto }>(`/api/agents/${agentId}/channels`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok && res.data.channels) {
      setData(res.data.channels);
      setNumber(res.data.channels.voice.number ?? '');
    } else setError(errorText(t, res.data.error));
  }

  const voice = settings.voice;
  return (
    <>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <FormSection title={t('channels.emailTitle')} description={t('channels.emailHint')}>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={settings.answerEmails}
            disabled={readOnly}
            onChange={(e) => onSettings({ ...settings, answerEmails: e.target.checked })}
          />
          {t('channels.answerEmails')}
        </label>
        {data === null ? (
          <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
        ) : !data.email.inboundConfigured ? (
          <p className="ui-help">{t('channels.emailNotConfigured')}</p>
        ) : data.email.widgets.length === 0 ? (
          <p className="ui-help">{t('channels.emailNoWidgets')}</p>
        ) : (
          data.email.widgets.map((w) => (w.address ? <Copyable key={w.id} value={w.address} label={t('channels.emailAddress', { widget: w.name })} /> : null))
        )}
      </FormSection>

      <FormSection title={t('channels.whatsappTitle')} description={t('channels.whatsappHint')}>
        {data === null ? (
          <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
        ) : !data.whatsapp.groupsAccess ? (
          <p className="ui-help">{t('channels.whatsappNoAccess')}</p>
        ) : data.whatsapp.numbers === 0 ? (
          <p className="ui-help">
            {t('channels.whatsappNoNumber')} <Link href="/app/groups">{t('channels.openGroups')}</Link>
          </p>
        ) : (
          <>
            <label className="ui-switch">
              <input
                type="checkbox"
                role="switch"
                checked={data.whatsapp.isDefault}
                disabled={!isAdmin || busy}
                onChange={(e) => void post({ action: 'whatsapp_default', on: e.target.checked })}
              />
              {t('channels.whatsappDefault')}
            </label>
            {data.whatsapp.otherDefault && !data.whatsapp.isDefault && <p className="ui-help">{t('channels.whatsappOther')}</p>}
            <p className="ui-help">{t('channels.whatsappChats', { count: data.whatsapp.assignedChats })}</p>
          </>
        )}
      </FormSection>

      <FormSection title={t('channels.voiceTitle')} description={t('channels.voiceHint')}>
        {data === null ? (
          <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
        ) : !data.voice.configured ? (
          <p className="ui-help">{t('channels.voiceNotConfigured')}</p>
        ) : (
          <>
            <form
              className="ag-add-row"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: 'voice_number', number: number.trim() || null });
              }}
            >
              <div className="ui-field">
                <label className="label" htmlFor="ag-voice-number">
                  {t('channels.voiceNumber')}
                </label>
                <select id="ag-voice-number" className="select data" value={number} disabled={!isAdmin} onChange={(e) => setNumber(e.target.value)}>
                  <option value="">{t('channels.voiceNoNumber')}</option>
                  {data.voice.numbers.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              {isAdmin && (number.trim() || data.voice.number) && (
                <button type="submit" className="btn btn-secondary" disabled={busy || number.trim() === (data.voice.number ?? '')}>
                  {number.trim() ? t('channels.voiceSave') : t('channels.voiceRemove')}
                </button>
              )}
            </form>
            {data.voice.number && <Copyable value={data.voice.webhookUrl} label={t('channels.voiceWebhook')} />}
          </>
        )}
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="ag-voice-lang">
              {t('channels.voiceLanguage')}
            </label>
            <select
              id="ag-voice-lang"
              className="select"
              value={voice.language}
              disabled={readOnly}
              onChange={(e) => onSettings({ ...settings, voice: { ...voice, language: e.target.value as typeof voice.language } })}
            >
              {AGENT_VOICE_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="ag-voice-handoff">
              {t('channels.voiceHandoff')}
            </label>
            <input
              id="ag-voice-handoff"
              className="input data"
              inputMode="tel"
              value={voice.handoffNumber}
              disabled={readOnly}
              placeholder="+14155550199"
              onChange={(e) => onSettings({ ...settings, voice: { ...voice, handoffNumber: e.target.value.replace(/[^\d+]/g, '') } })}
            />
          </div>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="ag-voice-greeting">
            {t('channels.voiceGreeting')}
          </label>
          <input
            id="ag-voice-greeting"
            className="input"
            maxLength={300}
            value={voice.greeting}
            disabled={readOnly}
            placeholder={t('channels.voiceGreetingPlaceholder')}
            onChange={(e) => onSettings({ ...settings, voice: { ...voice, greeting: e.target.value } })}
          />
        </div>
      </FormSection>

      <FormSection title={t('channels.slackTitle')} description={t('channels.slackHint')}>
        <IntegrationsPanel agentId={agentId} kinds={['slack']} isAdmin={isAdmin} onChange={() => void load()} />
        {data?.slack.connected && <Copyable value={data.slack.eventsUrl} label={t('channels.slackEvents')} />}
      </FormSection>

      <FormSection title={t('channels.metaTitle')} description={t('channels.metaHint')}>
        <IntegrationsPanel agentId={agentId} kinds={['meta']} isAdmin={isAdmin} onChange={() => void load()} />
        {data?.meta.connected && (
          <>
            <Copyable value={data.meta.webhookUrl} label={t('channels.metaWebhook')} />
            {data.meta.verifyToken && <Copyable value={data.meta.verifyToken} label={t('channels.metaVerify')} />}
          </>
        )}
      </FormSection>
    </>
  );
}

// ---------- Fuentes externas (Zendesk) ----------

export function SourcesPanel({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const [list, setList] = useState<AgentSourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState('');

  const load = useCallback(async () => {
    const res = await api<{ sources?: AgentSourceDto[] }>(`/api/agents/${agentId}/sources`);
    if (res.ok) setList(res.data.sources ?? []);
    else setError(errorText(t, res.data.error));
  }, [agentId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  // Mientras haya una fuente pendiente, se refresca el estado.
  const pending = list?.some((s) => s.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  async function call(init: RequestInit, query = '') {
    setError(null);
    const res = await api<{ sources?: AgentSourceDto[] }>(`/api/agents/${agentId}/sources${query}`, init);
    if (res.ok) {
      setList(res.data.sources ?? []);
      return true;
    }
    setError(errorText(t, res.data.error));
    return false;
  }

  return (
    <FormSection title={t('sources.title')} description={t('sources.hint')}>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {list === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="ui-help">{t('sources.empty')}</p>
      ) : (
        <ul className="ag-rows" data-testid="ag-sources">
          {list.map((s) => (
            <li key={s.id} className="ag-url">
              <div className="ag-url-main">
                <span className="ag-url-title data">{s.target}</span>
                <span className="ui-help">
                  {s.status === 'pending'
                    ? t('sources.reading')
                    : s.status === 'error'
                      ? errorText(t, s.error)
                      : t('sources.articles', { count: s.items })}
                  {s.syncedAt && s.status !== 'pending' ? ` · ${format.dateTime(parseDbUtc(s.syncedAt), { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                </span>
              </div>
              <span className={`badge${s.status === 'ok' ? ' badge-ok' : s.status === 'error' ? ' badge-bad' : ''}`}>{t(`knowledge.status.${s.status}`)}</span>
              {canEdit && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void call({ method: 'POST', body: JSON.stringify({ resync: s.id }) })}>
                    {t('knowledge.refresh')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`${t('knowledge.remove')}: ${s.target}`} onClick={() => void call({ method: 'DELETE' }, `?source=${encodeURIComponent(s.id)}`)}>
                    {t('knowledge.remove')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="ag-add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (target.trim() && (await call({ method: 'POST', body: JSON.stringify({ kind: 'zendesk', target: target.trim() }) }))) setTarget('');
          }}
        >
          <div className="ui-field">
            <label className="sr-only" htmlFor="ag-zendesk">
              {t('sources.zendesk')}
            </label>
            <input id="ag-zendesk" className="input data" value={target} placeholder="acme.zendesk.com" onChange={(e) => setTarget(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={!target.trim()}>
            {t('sources.add')}
          </button>
        </form>
      )}
      <p className="ui-help">
        {t('sources.docsImport')} <Link href="/app/docs/import?from=notion">{t('sources.importNotion')}</Link> ·{' '}
        <Link href="/app/docs/import?from=confluence">{t('sources.importConfluence')}</Link>
      </p>
    </FormSection>
  );
}

// ---------- Búsqueda semántica ----------

export function SemanticStatus({ agentId, on, dirty }: { agentId: string; on: boolean; dirty: boolean }) {
  const t = useTranslations('agents');
  const [status, setStatus] = useState<{ indexed: number; total: number } | null>(null);
  useEffect(() => {
    if (!on || dirty) return;
    let cancelled = false;
    const load = async () => {
      const res = await api<{ semantic?: { indexed: number; total: number } }>(`/api/agents/${agentId}/knowledge?semantic=1`);
      if (!cancelled && res.ok && res.data.semantic) setStatus(res.data.semantic);
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agentId, on, dirty]);
  if (!on) return null;
  if (dirty) return <p className="ui-help">{t('knowledge.saveFirst')}</p>;
  if (!status) return <span className="ui-skeleton ui-skeleton-text" aria-busy="true" />;
  return (
    <p className="ui-help" role="status" data-testid="ag-semantic-status">
      {status.total === 0 ? t('semantic.nothing') : t('semantic.progress', { indexed: Math.min(status.indexed, status.total), total: status.total })}
    </p>
  );
}

// ---------- Test A/B ----------

export function AbTestPanel({ agentId, canEdit, versioningEnabled, reloadKey }: { agentId: string; canEdit: boolean; versioningEnabled: boolean; reloadKey?: number }) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const [confirmNode, ask] = useConfirm();
  const [results, setResults] = useState<AgentAbResults | null>(null);
  const [versions, setVersions] = useState<AgentVersionDto[]>([]);
  const [versionId, setVersionId] = useState('');
  const [percent, setPercent] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api<{ results?: AgentAbResults }>(`/api/agents/${agentId}/ab`),
      api<{ versions?: AgentVersionDto[] }>(`/api/agents/${agentId}/versions`),
    ]).then(([r, v]) => {
      if (cancelled) return;
      if (r.ok && r.data.results) setResults(r.data.results);
      else setError(errorText(t, r.data.error));
      setVersions((v.data.versions ?? []).filter((x) => !x.live));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, t, reloadKey]);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!versionId) return;
    setBusy(true);
    setError(null);
    const res = await api<{ results?: AgentAbResults }>(`/api/agents/${agentId}/ab`, { method: 'POST', body: JSON.stringify({ versionId, percent }) });
    setBusy(false);
    if (res.ok && res.data.results) setResults(res.data.results);
    else setError(errorText(t, res.data.error));
  }

  async function stop(promote: boolean) {
    const n = results?.test?.versionNumber ?? 0;
    if (!(await ask({ title: promote ? t('ab.promoteConfirm', { number: n }) : t('ab.stopConfirm'), confirmLabel: promote ? t('ab.promote') : t('ab.stop') }))) return;
    setBusy(true);
    const res = await api<{ results?: AgentAbResults }>(`/api/agents/${agentId}/ab${promote ? '?promote=1' : ''}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok && res.data.results) setResults(res.data.results);
    else setError(errorText(t, res.data.error));
    if (promote && res.ok) window.location.reload();
  }

  const rate = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '-');
  const test = results?.test ?? null;
  return (
    <FormSection title={t('ab.title')} description={t('ab.hint')}>
      {confirmNode}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {!versioningEnabled ? (
        <p className="ui-help">{t('ab.needsVersions')}</p>
      ) : results === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : test ? (
        <div className="ag-connect" data-testid="ag-ab-running">
          <p className="ui-help" role="status">
            {t('ab.running', { number: test.versionNumber, percent: test.percent, since: format.dateTime(parseDbUtc(test.startedAt), { dateStyle: 'medium' }) })}
          </p>
          <div className="ag-ab-wrap">
            <table className="ag-ab-table">
              <thead>
                <tr>
                  <th scope="col">{t('ab.variant')}</th>
                  <th scope="col" className="data">
                    {t('ab.conversations')}
                  </th>
                  <th scope="col" className="data">
                    {t('ab.resolution')}
                  </th>
                  <th scope="col" className="data">
                    {t('ab.handoffs')}
                  </th>
                  <th scope="col" className="data">
                    {t('ab.thumbs')}
                  </th>
                  <th scope="col" className="data">
                    CSAT
                  </th>
                </tr>
              </thead>
              <tbody>
                {(['a', 'b'] as const).map((v) => {
                  const s = results[v];
                  return (
                    <tr key={v}>
                      <th scope="row">{v === 'a' ? t('ab.a') : t('ab.b', { number: test.versionNumber })}</th>
                      <td className="data">{s.conversations}</td>
                      <td className="data">{rate(s.resolved, s.conversations)}</td>
                      <td className="data">{s.handoffs}</td>
                      <td className="data">
                        {s.thumbsUp} / {s.thumbsDown}
                      </td>
                      <td className="data">{s.csat ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="ag-access-row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void stop(true)}>
                {t('ab.promote')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void stop(false)}>
                {t('ab.stop')}
              </button>
            </div>
          )}
        </div>
      ) : versions.length === 0 ? (
        <p className="ui-help">{t('ab.noVersions')}</p>
      ) : canEdit ? (
        <form className="ag-add-row" onSubmit={(e) => void start(e)}>
          <div className="ui-field">
            <label className="label" htmlFor="ag-ab-version">
              {t('ab.versionB')}
            </label>
            <select id="ag-ab-version" className="select" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">{t('tools.choose')}</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number}
                  {v.note ? ` · ${v.note}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field ag-field-num">
            <label className="label" htmlFor="ag-ab-percent">
              {t('ab.percent')}
            </label>
            <input id="ag-ab-percent" className="input" type="number" min={5} max={95} step={5} value={percent} onChange={(e) => setPercent(Math.min(95, Math.max(5, Number(e.target.value) || 50)))} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={!versionId || busy}>
            {t('ab.start')}
          </button>
        </form>
      ) : (
        <p className="ui-help">{t('ab.none')}</p>
      )}
    </FormSection>
  );
}

// ---------- Acceso por agente ----------

export function AccessPanel({ agentId, isAdmin }: { agentId: string; isAdmin: boolean }) {
  const t = useTranslations('agents');
  const [data, setData] = useState<AccessDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ access?: AccessDto }>(`/api/agents/${agentId}/access`).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data.access) setData(res.data.access);
      else setError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, t]);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const res = await api<{ access?: AccessDto }>(`/api/agents/${agentId}/access`, { method: 'PATCH', body: JSON.stringify(body) });
    if (res.ok && res.data.access) setData(res.data.access);
    else setError(errorText(t, res.data.error));
  }

  return (
    <FormSection title={t('access.title')} description={t('access.hint')}>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {data === null ? (
        <span className="ui-skeleton ui-skeleton-row" aria-busy="true" />
      ) : (
        <>
          <div className="ui-field ag-field-half">
            <label className="label" htmlFor="ag-access-members">
              {t('access.members')}
            </label>
            <select id="ag-access-members" className="select" value={data.members} disabled={!isAdmin} onChange={(e) => void patch({ members: e.target.value })}>
              <option value="viewer">{t('access.levels.viewer')}</option>
              <option value="none">{t('access.levels.none')}</option>
            </select>
          </div>
          <ul className="ag-rows" data-testid="ag-access-people">
            {data.people.map((p) => {
              const admin = p.role === 'owner' || p.role === 'admin';
              return (
                <li key={p.id} className="ag-access-row">
                  <span className="ag-access-name">
                    {p.name} <span className="ui-help">{p.email}</span>
                  </span>
                  {admin ? (
                    <span className="badge">{t('access.adminEdits')}</span>
                  ) : !p.hasApp ? (
                    <span className="badge badge-warn">{t('access.noApp')}</span>
                  ) : (
                    <>
                      <label className="sr-only" htmlFor={`ag-access-${p.id}`}>
                        {t('access.personLabel', { name: p.name })}
                      </label>
                      <select
                        id={`ag-access-${p.id}`}
                        className="select"
                        value={p.assigned ?? ''}
                        disabled={!isAdmin}
                        onChange={(e) => void patch({ person: { id: p.id, role: e.target.value || null } })}
                      >
                        <option value="">{t('access.default', { level: t(`access.levels.${data.members}`) })}</option>
                        <option value="editor">{t('access.levels.editor')}</option>
                        <option value="viewer">{t('access.levels.viewer')}</option>
                        <option value="none">{t('access.levels.none')}</option>
                      </select>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FormSection>
  );
}
