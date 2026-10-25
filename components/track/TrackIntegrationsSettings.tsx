'use client';

/**
 * Track › Ajustes: Integraciones (Slack, Sentry, Zendesk, Intercom, Figma,
 * Zapier), API y MCP, Acceso (proyectos privados e invitados) y Audit log.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import EmptyState from '@/components/ui/EmptyState';
import type { IntegrationEvent, IntegrationView } from '@/lib/track-integrations';
import type { SlackChannelSub, SlackConnection } from '@/lib/track-slack';
import type { AuditEntry } from '@/lib/track-audit';
import type { TrackGuest, ProjectAccessMember } from '@/lib/track-access';
import { CopyField } from './TrackSettingsClient';

async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

function Skeleton() {
  return (
    <div className="ui-loading-stack" aria-busy="true">
      <span className="ui-skeleton ui-skeleton-title" />
      <span className="ui-skeleton ui-skeleton-row" />
      <span className="ui-skeleton ui-skeleton-row" />
    </div>
  );
}

function fmtDate(raw: string, locale: string): string {
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

interface ProjectOpt {
  id: string;
  name: string;
}

function useProjects(): ProjectOpt[] {
  const [rows, setRows] = useState<ProjectOpt[]>([]);
  useEffect(() => {
    void send<{ rows: ProjectOpt[] }>('/api/track/projects?meta=1', 'GET')
      .then((r) => r.ok && setRows(r.data.rows.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => undefined);
  }, []);
  return rows;
}

function EventLog({ rows, locale }: { rows: IntegrationEvent[]; locale: string }) {
  const t = useTranslations('track');
  if (rows.length === 0) return <p className="ui-help">{t('integrations.logEmpty')}</p>;
  return (
    <ul className="track-int-log" aria-label={t('integrations.log')}>
      {rows.map((e) => (
        <li key={e.id} className={e.ok ? undefined : 'is-error'}>
          <span className="data">{e.direction === 'in' ? '←' : '→'}</span>
          <span className="track-int-log-text">{e.summary}</span>
          <span className="st-muted">{fmtDate(e.createdAt, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- Integraciones ----------

interface IntegrationsData {
  isAdmin: boolean;
  slack: {
    configured: boolean;
    connection: SlackConnection | null;
    subs: SlackChannelSub[];
    log: IntegrationEvent[];
    urls: { commands: string; interactions: string; events: string };
  };
  sentry: (IntegrationView & { webhookUrl: string; log: IntegrationEvent[] }) | null;
  zendesk: (IntegrationView & { log: IntegrationEvent[] }) | null;
  intercom: (IntegrationView & { log: IntegrationEvent[] }) | null;
}

const SLACK_EVENTS = ['issue_created', 'status_changed', 'issue_done', 'comment_created'] as const;

export function IntegrationsSettings({ locale }: { locale: string }) {
  const t = useTranslations('track');
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [failed, setFailed] = useState(false);
  const projects = useProjects();

  const load = useCallback(async () => {
    setFailed(false);
    const res = await send<IntegrationsData>('/api/track/integrations', 'GET').catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <FormSection title={t('integrations.title')}>
        <EmptyState
          quiet
          title={t('integrations.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      </FormSection>
    );
  }
  if (!data) {
    return (
      <FormSection title={t('integrations.title')}>
        <Skeleton />
      </FormSection>
    );
  }
  return (
    <div className="ui-page" data-testid="track-integrations-settings">
      <SlackSection data={data} projects={projects} reload={load} locale={locale} />
      <SentrySection data={data} projects={projects} reload={load} locale={locale} />
      <SupportSection provider="zendesk" data={data} reload={load} locale={locale} />
      <SupportSection provider="intercom" data={data} reload={load} locale={locale} />
      <FormSection title="Figma" description={t('integrations.figma.help')}>
        {null}
      </FormSection>
      <FormSection title={t('integrations.zapier.title')} description={t('integrations.zapier.help')}>
        <p className="ui-help">
          <Link href="/app/settings/workspace#webhooks">{t('integrations.zapier.webhooks')}</Link> ·{' '}
          <Link href="/docs#track">{t('integrations.zapier.docs')}</Link>
        </p>
      </FormSection>
    </div>
  );
}

function SlackSection({ data, projects, reload, locale }: { data: IntegrationsData; projects: ProjectOpt[]; reload: () => Promise<void>; locale: string }) {
  const t = useTranslations('track');
  const { slack, isAdmin } = data;
  const conn = slack.connection;
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [subProject, setSubProject] = useState('');
  const [subChannel, setSubChannel] = useState('');
  const [subEvents, setSubEvents] = useState<string[]>(['issue_created', 'status_changed']);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!conn || !isAdmin) return;
    void send<{ channels: Array<{ id: string; name: string }> }>('/api/track/integrations/slack/channels', 'GET')
      .then((r) => setChannels(r.ok ? r.data.channels : []))
      .catch(() => setChannels([]));
  }, [conn, isAdmin]);

  useEffect(() => {
    if (!subProject && projects[0]) setSubProject(projects[0].id);
  }, [projects, subProject]);
  useEffect(() => {
    if (!subChannel && channels?.[0]) setSubChannel(channels[0].id);
  }, [channels, subChannel]);

  if (!slack.configured) {
    return (
      <FormSection title="Slack" description={t('integrations.slack.help')}>
        <p className="ui-help" data-testid="track-slack-unavailable">
          {t('integrations.slack.notConfigured')}
        </p>
      </FormSection>
    );
  }
  if (!conn) {
    return (
      <FormSection
        title="Slack"
        description={t('integrations.slack.help')}
        footer={
          <>
            <span className="ui-section-note">{isAdmin ? t('integrations.notConnected') : t('integrations.adminOnly')}</span>
            {isAdmin ? (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a className="btn btn-primary" href="/api/track/slack/install" data-testid="track-slack-connect">
                {t('integrations.slack.connect')}
              </a>
            ) : null}
          </>
        }
      >
        {null}
      </FormSection>
    );
  }

  const saveSettings = async (body: { defaultProjectId?: string | null; unfurl?: boolean }) => {
    setError(null);
    const res = await send('/api/track/integrations/slack', 'PUT', body).catch(() => null);
    if (!res?.ok) setError(t('integrations.error'));
    await reload();
  };

  const addSub = async (e: FormEvent) => {
    e.preventDefault();
    if (!subProject || !subChannel || subEvents.length === 0) return;
    setBusy(true);
    setError(null);
    const channelName = channels?.find((c) => c.id === subChannel)?.name ?? '';
    const res = await send('/api/track/integrations/slack/channels', 'POST', {
      projectId: subProject,
      channelId: subChannel,
      channelName,
      events: subEvents,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(t('integrations.error'));
    await reload();
  };

  const removeSub = async (id: string) => {
    const res = await send(`/api/track/integrations/slack/channels?id=${encodeURIComponent(id)}`, 'DELETE').catch(() => null);
    if (!res?.ok) setError(t('integrations.error'));
    await reload();
  };

  const disconnect = async () => {
    if (!window.confirm(t('integrations.slack.disconnectConfirm'))) return;
    const res = await send('/api/track/integrations/slack', 'DELETE').catch(() => null);
    if (!res?.ok) setError(t('integrations.error'));
    await reload();
  };

  return (
    <FormSection
      title="Slack"
      description={t('integrations.slack.connectedTo', { team: conn.teamName || conn.teamId })}
      footer={
        <>
          <span className="ui-section-note" role={error ? 'alert' : undefined}>
            {error ?? (isAdmin ? '' : t('integrations.adminOnly'))}
          </span>
          {isAdmin ? (
            <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
              {t('integrations.disconnect')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="track-settings-block" data-testid="track-slack-settings">
        <p className="ui-help">{t('integrations.slack.howTo')}</p>
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="slack-default-project">
              {t('integrations.slack.defaultProject')}
            </label>
            <select
              id="slack-default-project"
              className="select"
              value={conn.defaultProjectId ?? ''}
              disabled={!isAdmin}
              onChange={(e) => void saveSettings({ defaultProjectId: e.target.value || null })}
            >
              <option value="">{t('integrations.slack.firstProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className="ui-check track-int-check">
            <input type="checkbox" checked={conn.unfurl} disabled={!isAdmin} onChange={(e) => void saveSettings({ unfurl: e.target.checked })} />
            <span>{t('integrations.slack.unfurl')}</span>
          </label>
        </div>

        <h3 className="track-int-subtitle">{t('integrations.slack.channels')}</h3>
        {slack.subs.length === 0 ? (
          <p className="ui-help">{t('integrations.slack.noChannels')}</p>
        ) : (
          <ul className="track-status-list" data-testid="track-slack-subs">
            {slack.subs.map((s) => (
              <li key={s.id} className="track-status-item track-int-row">
                <span className="data">#{s.channelName || s.channelId}</span>
                <span>{s.projectName}</span>
                <span className="st-muted">{s.events.map((ev) => t(`integrations.slack.events.${ev}`)).join(', ')}</span>
                {isAdmin ? (
                  <button type="button" className="btn btn-sm" onClick={() => void removeSub(s.id)} aria-label={t('integrations.slack.removeChannel', { channel: s.channelName })}>
                    {t('integrations.remove')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <form className="track-int-form" onSubmit={(e) => void addSub(e)} aria-label={t('integrations.slack.addChannel')}>
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor="slack-sub-project">
                  {t('integrations.project')}
                </label>
                <select id="slack-sub-project" className="select" value={subProject} onChange={(e) => setSubProject(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor="slack-sub-channel">
                  {t('integrations.slack.channel')}
                </label>
                <select id="slack-sub-channel" className="select" value={subChannel} onChange={(e) => setSubChannel(e.target.value)} disabled={!channels?.length}>
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="track-int-events">
              <legend className="label">{t('integrations.slack.eventsLabel')}</legend>
              {SLACK_EVENTS.map((ev) => (
                <label key={ev} className="ui-check">
                  <input
                    type="checkbox"
                    checked={subEvents.includes(ev)}
                    onChange={() => setSubEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]))}
                  />
                  <span>{t(`integrations.slack.events.${ev}`)}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn" disabled={busy || !subProject || !subChannel || subEvents.length === 0} data-testid="track-slack-add-channel">
              {t('integrations.slack.addChannel')}
            </button>
          </form>
        ) : null}

        {isAdmin ? (
          <AdvancedSection storageKey="track.slack.setup" label={t('integrations.slack.setupTitle')} hint={t('integrations.slack.setupHint')}>
            <CopyField id="slack-commands" label={t('integrations.slack.commandsUrl')} value={slack.urls.commands} />
            <CopyField id="slack-interactions" label={t('integrations.slack.interactionsUrl')} value={slack.urls.interactions} />
            <CopyField id="slack-events" label={t('integrations.slack.eventsUrl')} value={slack.urls.events} />
          </AdvancedSection>
        ) : null}

        {isAdmin ? (
          <>
            <h3 className="track-int-subtitle">{t('integrations.log')}</h3>
            <EventLog rows={slack.log} locale={locale} />
          </>
        ) : null}
      </div>
    </FormSection>
  );
}

function SentrySection({ data, projects, reload, locale }: { data: IntegrationsData; projects: ProjectOpt[]; reload: () => Promise<void>; locale: string }) {
  const t = useTranslations('track');
  const s = data.sentry;
  const cfg = (s?.config ?? {}) as { projectId?: string; orgSlug?: string; baseUrl?: string; autoResolve?: boolean };
  const [open, setOpen] = useState(false);

  const save = async (form: FormData): Promise<string | void> => {
    const body = {
      projectId: String(form.get('projectId') ?? ''),
      orgSlug: String(form.get('orgSlug') ?? '').trim(),
      baseUrl: String(form.get('baseUrl') ?? '').trim(),
      autoResolve: form.get('autoResolve') === 'on',
      secret: String(form.get('secret') ?? '').trim() || undefined,
      token: String(form.get('token') ?? '').trim() || undefined,
    };
    const res = await send<{ error?: string }>('/api/track/integrations/sentry', 'PUT', body).catch(() => null);
    if (!res?.ok) return res?.data.error === 'missing_secret' ? t('integrations.sentry.missingSecret') : t('integrations.error');
    await reload();
  };
  const disconnect = async () => {
    if (!window.confirm(t('integrations.disconnectConfirm', { name: 'Sentry' }))) return;
    await send('/api/track/integrations/sentry', 'DELETE').catch(() => null);
    await reload();
  };

  if (!s && !open) {
    return (
      <FormSection
        title="Sentry"
        description={t('integrations.sentry.help')}
        footer={
          <>
            <span className="ui-section-note">{data.isAdmin ? t('integrations.notConnected') : t('integrations.adminOnly')}</span>
            {data.isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="track-sentry-start">
                {t('integrations.connect')}
              </button>
            ) : null}
          </>
        }
      >
        {null}
      </FormSection>
    );
  }
  return (
    <>
      <FormSection
        title="Sentry"
        description={t('integrations.sentry.help')}
        onSubmit={save}
        submitLabel={s ? t('integrations.save') : t('integrations.connect')}
        disabled={!data.isAdmin}
      >
        <div className="track-settings-block" data-testid="track-sentry-form">
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="sentry-project">
                {t('integrations.sentry.project')}
              </label>
              <select id="sentry-project" name="projectId" className="select" defaultValue={cfg.projectId ?? projects[0]?.id ?? ''} key={projects.length}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="sentry-org">
                {t('integrations.sentry.org')}
              </label>
              <input id="sentry-org" name="orgSlug" className="input data" defaultValue={cfg.orgSlug ?? ''} placeholder="acme" required />
            </div>
          </div>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="sentry-secret">
                {t('integrations.sentry.secret')}
              </label>
              <input id="sentry-secret" name="secret" type="password" className="input data" autoComplete="off" placeholder={s ? t('integrations.keepSecret') : ''} />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="sentry-token">
                {t('integrations.sentry.token')}
              </label>
              <input id="sentry-token" name="token" type="password" className="input data" autoComplete="off" placeholder={s?.hasToken ? t('integrations.keepSecret') : ''} />
            </div>
          </div>
          <label className="ui-check">
            <input type="checkbox" name="autoResolve" defaultChecked={cfg.autoResolve !== false} />
            <span>{t('integrations.sentry.autoResolve')}</span>
          </label>
          <AdvancedSection storageKey="track.sentry.base" label={t('integrations.sentry.selfHosted')}>
            <div className="ui-field">
              <label className="label" htmlFor="sentry-base">
                {t('integrations.sentry.baseUrl')}
              </label>
              <input id="sentry-base" name="baseUrl" className="input data" defaultValue={cfg.baseUrl ?? ''} placeholder="https://sentry.io" />
            </div>
          </AdvancedSection>
          <p className="ui-help">{t('integrations.sentry.steps')}</p>
        </div>
      </FormSection>
      {s ? (
        <FormSection
          title={t('integrations.sentry.webhookTitle')}
          footer={
            data.isAdmin ? (
              <>
                <span className="ui-section-note" />
                <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
                  {t('integrations.disconnect')}
                </button>
              </>
            ) : undefined
          }
        >
          <div className="track-settings-block">
            <CopyField id="sentry-url" label={t('integrations.sentry.webhookUrl')} value={s.webhookUrl} testId="track-sentry-url" />
            <h3 className="track-int-subtitle">{t('integrations.log')}</h3>
            <EventLog rows={s.log} locale={locale} />
          </div>
        </FormSection>
      ) : null}
    </>
  );
}

function SupportSection({ provider, data, reload, locale }: { provider: 'zendesk' | 'intercom'; data: IntegrationsData; reload: () => Promise<void>; locale: string }) {
  const t = useTranslations('track');
  const row = data[provider];
  const cfg = (row?.config ?? {}) as { subdomain?: string; email?: string; adminId?: string };
  const [open, setOpen] = useState(false);
  const name = provider === 'zendesk' ? 'Zendesk' : 'Intercom';

  const save = async (form: FormData): Promise<string | void> => {
    const token = String(form.get('token') ?? '').trim() || undefined;
    const body =
      provider === 'zendesk'
        ? { subdomain: String(form.get('subdomain') ?? '').trim(), email: String(form.get('email') ?? '').trim(), token }
        : { adminId: String(form.get('adminId') ?? '').trim(), token };
    const res = await send<{ error?: string }>(`/api/track/integrations/${provider}`, 'PUT', body).catch(() => null);
    if (!res?.ok) return res?.data.error === 'missing_token' ? t('integrations.missingToken') : t('integrations.error');
    await reload();
  };
  const disconnect = async () => {
    if (!window.confirm(t('integrations.disconnectConfirm', { name }))) return;
    await send(`/api/track/integrations/${provider}`, 'DELETE').catch(() => null);
    await reload();
  };

  if (!row && !open) {
    return (
      <FormSection
        title={name}
        description={t(`integrations.${provider}.help`)}
        footer={
          <>
            <span className="ui-section-note">{data.isAdmin ? t('integrations.notConnected') : t('integrations.adminOnly')}</span>
            {data.isAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid={`track-${provider}-start`}>
                {t('integrations.connect')}
              </button>
            ) : null}
          </>
        }
      >
        {null}
      </FormSection>
    );
  }
  return (
    <FormSection
      title={name}
      description={t(`integrations.${provider}.help`)}
      onSubmit={save}
      submitLabel={row ? t('integrations.save') : t('integrations.connect')}
      disabled={!data.isAdmin}
      footer={undefined}
    >
      <div className="track-settings-block" data-testid={`track-${provider}-form`}>
        {provider === 'zendesk' ? (
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="zd-sub">
                {t('integrations.zendesk.subdomain')}
              </label>
              <input id="zd-sub" name="subdomain" className="input data" defaultValue={cfg.subdomain ?? ''} placeholder="acme" required />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="zd-email">
                {t('integrations.zendesk.email')}
              </label>
              <input id="zd-email" name="email" type="email" className="input" defaultValue={cfg.email ?? ''} required />
            </div>
          </div>
        ) : (
          <div className="ui-field">
            <label className="label" htmlFor="ic-admin">
              {t('integrations.intercom.adminId')}
            </label>
            <input id="ic-admin" name="adminId" className="input data" defaultValue={cfg.adminId ?? ''} inputMode="numeric" required />
          </div>
        )}
        <div className="ui-field">
          <label className="label" htmlFor={`${provider}-token`}>
            {t('integrations.apiToken')}
          </label>
          <input id={`${provider}-token`} name="token" type="password" className="input data" autoComplete="off" placeholder={row?.hasToken ? t('integrations.keepSecret') : ''} />
        </div>
        <p className="ui-help">{t(`integrations.${provider}.steps`)}</p>
        {row ? (
          <>
            <h3 className="track-int-subtitle">{t('integrations.log')}</h3>
            <EventLog rows={row.log} locale={locale} />
            {data.isAdmin ? (
              <button type="button" className="btn btn-danger" onClick={() => void disconnect()}>
                {t('integrations.disconnect')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </FormSection>
  );
}

// ---------- GitHub: App y reglas por proyecto ----------

interface MetaProject {
  id: string;
  name: string;
  statuses: Array<{ id: string; name: string; category: string }>;
}

interface RuleRow {
  projectId: string;
  onDraft: string | null;
  onOpen: string | null;
  onReview: string | null;
  onMerge: string | null;
  syncRepo: string | null;
}

const RULE_KEYS = ['onDraft', 'onOpen', 'onReview', 'onMerge'] as const;

/** Instalar la GitHub App y, por proyecto, a qué status mueve cada momento del PR y qué repo sincroniza. */
export function GithubExtras({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('track');
  const [projects, setProjects] = useState<MetaProject[]>([]);
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [appAvailable, setAppAvailable] = useState(false);
  const [install, setInstall] = useState<{ id: number | null; login: string | null } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, r, c] = await Promise.all([
      send<{ rows: MetaProject[] }>('/api/track/projects?meta=1', 'GET').catch(() => null),
      send<{ rows: RuleRow[]; appAvailable: boolean }>('/api/track/github/rules', 'GET').catch(() => null),
      send<{ config: { installationId: number | null; accountLogin: string | null } | null }>('/api/track/github', 'GET').catch(() => null),
    ]);
    if (p?.ok) setProjects(p.data.rows);
    setRules(r?.ok ? r.data.rows : []);
    setAppAvailable(Boolean(r?.data.appAvailable));
    setInstall(c?.ok && c.data.config ? { id: c.data.config.installationId, login: c.data.config.accountLogin } : null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const saveRule = async (projectId: string, body: Partial<RuleRow> & { reset?: boolean }) => {
    setError(null);
    setSaved(null);
    const res = await send<{ rows: RuleRow[]; error?: string }>('/api/track/github/rules', 'PUT', { projectId, ...body }).catch(() => null);
    if (!res?.ok) {
      setError(res?.data.error === 'invalid_repo' ? t('github.invalidRepo') : t('github.error'));
      void load();
      return;
    }
    setRules(res.data.rows);
    setSaved(projectId);
  };

  return (
    <>
      {appAvailable ? (
        <FormSection
          title={t('github.appTitle')}
          description={t('github.appHelp')}
          footer={
            <>
              <span className="ui-section-note" data-testid="track-github-app-status">
                {install?.id ? t('github.appInstalled', { account: install.login ?? String(install.id) }) : t('github.appNotInstalled')}
              </span>
              {isAdmin ? (
                // eslint-disable-next-line @next/next/no-html-link-for-pages
                <a className="btn btn-primary" href="/api/track/github/app/install" data-testid="track-github-app-install">
                  {install?.id ? t('github.appReinstall') : t('github.appInstall')}
                </a>
              ) : null}
            </>
          }
        >
          {null}
        </FormSection>
      ) : null}
      <FormSection title={t('github.rulesTitle')} description={t('github.rulesHelp')}>
        <div className="track-settings-block" data-testid="track-github-rules">
          {error ? (
            <p className="ui-error" role="alert">
              {error}
            </p>
          ) : null}
          {rules === null ? (
            <Skeleton />
          ) : projects.length === 0 ? (
            <p className="ui-help">{t('github.rulesNoProjects')}</p>
          ) : (
            <ul className="track-status-list">
              {projects.map((p) => {
                const rule = rules.find((r) => r.projectId === p.id) ?? null;
                const firstOf = (cat: string) => p.statuses.find((s) => s.category === cat)?.id ?? null;
                return (
                  <li key={p.id} className="track-status-item track-access-item" data-testid="track-github-rule">
                    <div className="track-int-row">
                      <span className="track-access-name">{p.name}</span>
                      <label className="ui-check">
                        <input
                          type="checkbox"
                          checked={Boolean(rule)}
                          disabled={!isAdmin}
                          onChange={(e) => {
                            const next: RuleRow = { projectId: p.id, onDraft: null, onOpen: firstOf('in_progress'), onReview: null, onMerge: firstOf('done'), syncRepo: null };
                            // Optimista: el formulario aparece (o se va) ya; la respuesta lo confirma.
                            setRules((prev) => (e.target.checked ? [...(prev ?? []).filter((r) => r.projectId !== p.id), next] : (prev ?? []).filter((r) => r.projectId !== p.id)));
                            void saveRule(p.id, e.target.checked ? next : { reset: true });
                          }}
                        />
                        <span>{t('github.customRules')}</span>
                      </label>
                      {saved === p.id ? (
                        <span className="st-muted" role="status">
                          {t('github.saved')}
                        </span>
                      ) : null}
                    </div>
                    {rule ? (
                      <form
                        className="track-int-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const v = (k: string) => (String(f.get(k) ?? '') || null) as string | null;
                          void saveRule(p.id, { onDraft: v('onDraft'), onOpen: v('onOpen'), onReview: v('onReview'), onMerge: v('onMerge'), syncRepo: v('syncRepo') });
                        }}
                      >
                        <div className="track-gh-rules-grid">
                          {RULE_KEYS.map((k) => (
                            <div className="ui-field" key={k}>
                              <label className="label" htmlFor={`gh-${k}-${p.id}`}>
                                {t(`github.rule.${k}`)}
                              </label>
                              <select id={`gh-${k}-${p.id}`} name={k} className="select" defaultValue={rule[k] ?? ''} disabled={!isAdmin}>
                                <option value="">{t('github.doNothing')}</option>
                                {p.statuses.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                        <div className="ui-field">
                          <label className="label" htmlFor={`gh-sync-${p.id}`}>
                            {t('github.syncRepo')}
                          </label>
                          <input
                            id={`gh-sync-${p.id}`}
                            name="syncRepo"
                            className="input data"
                            defaultValue={rule.syncRepo ?? ''}
                            placeholder="acme/web"
                            disabled={!isAdmin}
                          />
                          <p className="ui-help">{t('github.syncRepoHelp')}</p>
                        </div>
                        <button type="submit" className="btn" disabled={!isAdmin}>
                          {t('github.save')}
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="ui-help">{t('github.magicWords')}</p>
        </div>
      </FormSection>
    </>
  );
}

// ---------- API y MCP ----------

export function ApiSettings() {
  const t = useTranslations('track');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const mcpUrl = `${origin}/api/mcp/track`;
  const config = JSON.stringify(
    { mcpServers: { 'zerosoft-track': { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer zs_…' } } } },
    null,
    2,
  );
  return (
    <div className="ui-page" data-testid="track-api-settings">
      <FormSection title={t('apiSettings.apiTitle')} description={t('apiSettings.apiHelp')}>
        <div className="track-settings-block">
          <CopyField id="api-base" label={t('apiSettings.baseUrl')} value={`${origin}/api/v1/track`} />
          <p className="ui-help">
            <Link href="/app/settings/workspace#api-keys">{t('apiSettings.keys')}</Link> · <Link href="/docs#track">{t('apiSettings.docs')}</Link>
          </p>
        </div>
      </FormSection>
      <FormSection title={t('apiSettings.webhooksTitle')} description={t('apiSettings.webhooksHelp')}>
        <p className="ui-help">
          <Link href="/app/settings/workspace#webhooks">{t('apiSettings.webhooksLink')}</Link>
        </p>
      </FormSection>
      <FormSection title={t('apiSettings.mcpTitle')} description={t('apiSettings.mcpHelp')}>
        <div className="track-settings-block">
          <CopyField id="mcp-url" label={t('apiSettings.mcpUrl')} value={mcpUrl} testId="track-mcp-url" />
          <CopyField id="mcp-url-ro" label={t('apiSettings.mcpReadonly')} value={`${mcpUrl}/readonly`} />
          <div className="ui-field">
            <span className="label">{t('apiSettings.mcpConfig')}</span>
            <pre className="track-int-code data">{config}</pre>
            <p className="ui-help">{t('apiSettings.mcpTools')}</p>
          </div>
        </div>
      </FormSection>
    </div>
  );
}

// ---------- Acceso ----------

interface AccessData {
  personal: boolean;
  me?: string;
  projects: Array<{ id: string; name: string; status: string; visibility: 'workspace' | 'private'; members: ProjectAccessMember[] }>;
  guests: TrackGuest[];
  people: Array<{ id: string; email: string; name: string | null; role: string }>;
}

export function AccessSettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('track');
  const [data, setData] = useState<AccessData | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestEmail, setGuestEmail] = useState('');
  const [guestProjects, setGuestProjects] = useState<string[]>([]);
  const [addFor, setAddFor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setFailed(false);
    const res = await send<AccessData>('/api/track/access', 'GET').catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setData(res.data);
  }, []);
  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const act = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await send<AccessData & { error?: string }>('/api/track/access', 'POST', body).catch(() => null);
    if (!res?.ok) {
      setError(res?.data.error === 'admin_cannot_be_guest' ? t('access.adminGuest') : t('access.error'));
      return false;
    }
    setData(res.data);
    return true;
  };

  const peopleById = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);

  if (!isAdmin) {
    return (
      <FormSection title={t('access.title')} description={t('access.help')}>
        <p className="ui-help">{t('access.adminOnly')}</p>
      </FormSection>
    );
  }
  if (failed) {
    return (
      <FormSection title={t('access.title')}>
        <EmptyState
          quiet
          title={t('access.loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          }
        />
      </FormSection>
    );
  }
  if (!data) {
    return (
      <FormSection title={t('access.title')}>
        <Skeleton />
      </FormSection>
    );
  }
  if (data.personal) {
    return (
      <FormSection title={t('access.title')} description={t('access.help')}>
        <p className="ui-help" data-testid="track-access-personal">
          {t('access.personal')}
        </p>
      </FormSection>
    );
  }

  const memberIds = new Set(data.people.map((p) => p.id));
  return (
    <div className="ui-page" data-testid="track-access-settings">
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : null}
      <FormSection title={t('access.projectsTitle')} description={t('access.projectsHelp')}>
        {data.projects.length === 0 ? (
          <p className="ui-help">{t('access.noProjects')}</p>
        ) : (
          <ul className="track-status-list">
            {data.projects.map((p) => {
              const isMember = p.members.some((m) => m.userId === data.me);
              const candidates = data.people.filter((person) => !p.members.some((m) => m.userId === person.id));
              return (
                <li key={p.id} className="track-status-item track-access-item" data-testid="track-access-project">
                  <div className="track-int-row">
                    <span className="track-access-name">{p.name}</span>
                    <label className="track-int-inline">
                      <span className="sr-only">{t('access.visibility', { name: p.name })}</span>
                      <select
                        className="select"
                        value={p.visibility}
                        onChange={(e) => void act({ action: 'visibility', projectId: p.id, visibility: e.target.value })}
                        aria-label={t('access.visibility', { name: p.name })}
                      >
                        <option value="workspace">{t('access.workspace')}</option>
                        <option value="private">{t('access.private')}</option>
                      </select>
                    </label>
                    {p.visibility === 'private' && !isMember ? (
                      <button type="button" className="btn btn-sm" onClick={() => void act({ action: 'addMember', projectId: p.id, userId: data.me })}>
                        {t('access.join')}
                      </button>
                    ) : null}
                  </div>
                  {p.visibility === 'private' ? (
                    <div className="track-access-members">
                      <span className="st-muted">{t('access.members', { count: p.members.length })}</span>
                      <ul className="track-access-chips">
                        {p.members.map((m) => (
                          <li key={m.userId}>
                            <span>{m.name || m.email}</span>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              aria-label={t('access.removeMember', { name: m.name || m.email })}
                              onClick={() => void act({ action: 'removeMember', projectId: p.id, userId: m.userId })}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                      {candidates.length > 0 ? (
                        <form
                          className="track-int-row"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const userId = addFor[p.id] ?? candidates[0]?.id;
                            if (userId && memberIds.has(userId)) void act({ action: 'addMember', projectId: p.id, userId });
                          }}
                        >
                          <select
                            className="select"
                            aria-label={t('access.addMember')}
                            value={addFor[p.id] ?? candidates[0]?.id ?? ''}
                            onChange={(e) => setAddFor((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          >
                            {candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name || c.email}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="btn btn-sm">
                            {t('access.addMember')}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </FormSection>

      <FormSection title={t('access.guestsTitle')} description={t('access.guestsHelp')}>
        <div className="track-settings-block">
          {data.guests.length === 0 ? (
            <p className="ui-help">{t('access.noGuests')}</p>
          ) : (
            <ul className="track-status-list" data-testid="track-guests">
              {data.guests.map((g) => (
                <li key={g.email} className="track-status-item track-int-row">
                  <span className="data">{g.email}</span>
                  <span className="st-muted">
                    {g.userId ? '' : `${t('access.pending')} · `}
                    {g.projectIds.length === 0
                      ? t('access.noAccess')
                      : g.projectIds.map((id) => data.projects.find((p) => p.id === id)?.name ?? '').filter(Boolean).join(', ')}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setGuestEmail(g.email);
                      setGuestProjects(g.projectIds);
                    }}
                  >
                    {t('access.edit')}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void act({ action: 'removeGuest', email: g.email })}>
                    {t('access.removeGuest')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="track-int-form"
            aria-label={t('access.guestForm')}
            onSubmit={(e) => {
              e.preventDefault();
              if (!guestEmail.trim()) return;
              void act({ action: 'setGuest', email: guestEmail.trim(), projectIds: guestProjects }).then((ok) => {
                if (ok) {
                  setGuestEmail('');
                  setGuestProjects([]);
                }
              });
            }}
          >
            <div className="ui-field">
              <label className="label" htmlFor="guest-email">
                {t('access.guestEmail')}
              </label>
              <input
                id="guest-email"
                type="email"
                className="input"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                list="track-access-people"
                required
                data-testid="track-guest-email"
              />
              <datalist id="track-access-people">
                {data.people
                  .filter((p) => p.role === 'member')
                  .map((p) => (
                    <option key={p.id} value={p.email} />
                  ))}
              </datalist>
              <p className="ui-help">
                {t('access.guestEmailHelp')} <Link href="/app/settings/workspace">{t('access.inviteLink')}</Link>
              </p>
            </div>
            <fieldset className="track-int-events">
              <legend className="label">{t('access.guestProjects')}</legend>
              {data.projects
                .filter((p) => p.status !== 'archived')
                .map((p) => (
                  <label key={p.id} className="ui-check">
                    <input
                      type="checkbox"
                      checked={guestProjects.includes(p.id)}
                      onChange={() => setGuestProjects((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
            </fieldset>
            <button type="submit" className="btn" data-testid="track-guest-save">
              {t('access.saveGuest')}
            </button>
          </form>
        </div>
      </FormSection>
      <p className="ui-help">{peopleById.size > 0 ? t('access.footnote') : null}</p>
    </div>
  );
}

// ---------- Audit log ----------

const ACTION_KEYS = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'comment.created',
  'project.created',
  'project.updated',
  'project.deleted',
  'project.visibility',
  'access.member_added',
  'access.member_removed',
  'access.guest_set',
  'access.guest_removed',
  'integration.connected',
  'integration.updated',
  'integration.disconnected',
] as const;

function describeData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object)) {
      const d = v as { from: unknown; to: unknown };
      parts.push(`${k}: ${d.from ?? '∅'} → ${d.to ?? '∅'}`);
    } else if (k === 'excerpt' || k === 'linked' || k === 'source' || k === 'visibility') {
      parts.push(`${k}: ${String(v)}`);
    }
  }
  return parts.join(' · ').slice(0, 300);
}

export function AuditLogSettings({ isAdmin, locale }: { isAdmin: boolean; locale: string }) {
  const t = useTranslations('track');
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (action) sp.set('action', action);
    if (q.trim()) sp.set('q', q.trim());
    return sp;
  }, [action, q]);

  const load = useCallback(
    async (nextOffset: number) => {
      setFailed(false);
      const sp = new URLSearchParams(params);
      sp.set('offset', String(nextOffset));
      const res = await send<{ rows: AuditEntry[]; total: number }>(`/api/track/audit?${sp}`, 'GET').catch(() => null);
      if (!res?.ok) {
        setFailed(true);
        setRows([]);
        return;
      }
      setRows((prev) => (nextOffset === 0 ? res.data.rows : [...(prev ?? []), ...res.data.rows]));
      setTotal(res.data.total);
      setOffset(nextOffset);
    },
    [params],
  );

  useEffect(() => {
    if (!isAdmin) return;
    const id = window.setTimeout(() => void load(0), 200);
    return () => window.clearTimeout(id);
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <FormSection title={t('audit.title')} description={t('audit.help')}>
        <p className="ui-help">{t('audit.adminOnly')}</p>
      </FormSection>
    );
  }

  return (
    <FormSection title={t('audit.title')} description={t('audit.help')}>
      <div className="track-settings-block" data-testid="track-audit">
        <div className="track-int-row track-audit-filters">
          <label className="ui-field">
            <span className="label">{t('audit.action')}</span>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)} data-testid="track-audit-action">
              <option value="">{t('audit.allActions')}</option>
              {ACTION_KEYS.map((a) => (
                <option key={a} value={a}>
                  {t(`audit.actions.${a.replace('.', '_')}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-field">
            <span className="label">{t('audit.search')}</span>
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('audit.searchPlaceholder')} />
          </label>
          <a className="btn" href={`/api/track/audit?${new URLSearchParams([...params.entries(), ['format', 'csv']])}`} download data-testid="track-audit-export">
            {t('audit.export')}
          </a>
        </div>
        {failed ? (
          <EmptyState
            quiet
            title={t('audit.loadError')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => void load(0)}>
                {t('common.retry')}
              </button>
            }
          />
        ) : rows === null ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <EmptyState quiet title={t('audit.empty')} body={t('audit.emptyBody')} />
        ) : (
          <>
            <ul className="track-audit-list">
              {rows.map((r) => (
                <li key={r.id} className="track-audit-row" data-testid="track-audit-row">
                  <div className="track-audit-main">
                    <strong>{r.actorName || r.actorEmail || t('audit.system')}</strong>{' '}
                    <span>{t(`audit.actions.${r.action.replace('.', '_')}`)}</span>{' '}
                    {r.entityId && r.entityType === 'issue' ? (
                      <Link href={`/app/track/issues/${r.entityId}`}>{r.entityLabel}</Link>
                    ) : (
                      <span>{r.entityLabel}</span>
                    )}
                  </div>
                  {describeData(r.data) ? <div className="track-audit-detail st-muted">{describeData(r.data)}</div> : null}
                  <div className="track-audit-meta st-muted">
                    {fmtDate(r.createdAt, locale)} · {t(`audit.via.${r.via}`)}
                    {r.projectName ? ` · ${r.projectName}` : ''}
                    {r.ip ? <span className="data"> · {r.ip}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
            {rows.length < total ? (
              <button type="button" className="btn" onClick={() => void load(offset + 50)}>
                {t('audit.more')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </FormSection>
  );
}
