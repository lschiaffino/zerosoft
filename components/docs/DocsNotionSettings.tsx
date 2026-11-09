'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type Direction = 'two_way' | 'import' | 'to_notion';

interface Status {
  oauth: boolean;
  connection: null | {
    kind: 'oauth' | 'token';
    workspaceName: string;
    direction: Direction;
    paused: boolean;
    status: 'discovering' | 'importing' | 'live' | 'error';
    error: string | null;
    lastSyncAt: string | null;
    createdAt: string;
    webhooks: boolean;
    teamspaceId: string | null;
  };
  progress: { total: number; synced: number; pending: number; errors: number; skipped: number };
  roots: Array<{ id: string; title: string; kind: string; enabled: boolean }>;
  log: Array<{ id: string; dir: string; action: string; title: string; pageId: string | null; detail: string | null; at: string }>;
  webhookToken?: string | null;
  webhookWaiting?: boolean;
}

const DIRECTIONS: Direction[] = ['two_way', 'import', 'to_notion'];
const KNOWN_ACTIONS = new Set([
  'created', 'updated', 'archived', 'restored', 'comment', 'unshared', 'conflict_notion', 'conflict_docs', 'too_large', 'error', 'connected',
  'disconnected', 'discovered', 'imported', 'paused', 'resumed', 'rate_limited', 'direction_two_way', 'direction_import', 'direction_to_notion',
]);

/**
 * Docs › Ajustes › Integraciones › Notion: conectar (OAuth o token de una
 * integración interna), qué se sincroniza, en qué dirección, pausa,
 * desconexión y el registro de la sincronización. Mientras dura el import
 * inicial, la pantalla lo empuja (además del cron).
 */
export function DocsNotionSettings({ notice }: { notice?: string | null }) {
  const t = useTranslations('docs.notionSync');
  const locale = useLocale();
  const uid = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const driving = useRef(false);

  const load = useCallback(async () => {
    setLoadError(false);
    const res = await fetch('/api/docs/notion', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) {
      setLoadError(true);
      return;
    }
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const conn = status?.connection ?? null;
  const importing = Boolean(conn && !conn.paused && (conn.status === 'discovering' || conn.status === 'importing'));

  // Import inicial: la pantalla abierta lo hace avanzar (de a unos segundos por pedido).
  useEffect(() => {
    if (!importing) return;
    let stop = false;
    const tick = async () => {
      if (stop || driving.current) return;
      if (document.visibilityState !== 'visible') return;
      driving.current = true;
      const res = await fetch('/api/docs/notion/sync', { method: 'POST' }).catch(() => null);
      driving.current = false;
      if (stop) return;
      if (res?.ok) setStatus((await res.json()) as Status);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [importing]);

  // En vivo: el registro y el estado se refrescan solos.
  useEffect(() => {
    if (!conn || importing) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [conn, importing, load]);

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<string | null> {
    const res = await fetch('/api/docs/notion', {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Status & { error?: string }) | null;
    if (!res?.ok || !data || data.error) {
      const code = data?.error ?? 'failed';
      return t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.failed');
    }
    setStatus(data);
    return null;
  }

  async function connect() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setConnectError(null);
    const err = await send('POST', { token: token.trim() });
    setBusy(false);
    if (err) setConnectError(err);
    else setToken('');
  }

  async function syncNow() {
    if (busy) return;
    setBusy(true);
    setSyncNote(null);
    const res = await fetch('/api/docs/notion/sync', { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setSyncNote(t('errors.failed'));
      return;
    }
    const data = (await res.json()) as Status & { ran: boolean };
    setStatus(data);
    setSyncNote(data.ran ? t('syncedNow') : t('alreadyRunning'));
  }

  async function disconnect() {
    setBusy(true);
    await send('DELETE');
    setBusy(false);
    setConfirmOff(false);
  }

  if (loadError) {
    return (
      <EmptyState
        title={t('loadError')}
        action={
          <button type="button" className="btn" onClick={() => void load()}>
            {t('retry')}
          </button>
        }
      />
    );
  }
  if (!status) {
    return (
      <div className="ui-loading-stack" role="status" aria-label={t('loading')}>
        <div className="ui-skeleton ui-skeleton-row" />
        <div className="ui-skeleton ui-skeleton-row" />
      </div>
    );
  }

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const p = status.progress;
  const done = p.synced + p.skipped + p.errors;

  return (
    <>
      {notice ? (
        <p className={notice === 'connected' ? 'ui-help docs-notion-notice' : 'ui-error docs-notion-notice'} role="status" data-testid="notion-sync-notice">
          {t(`notice.${notice === 'connected' || notice === 'denied' ? notice : 'error'}`)}
        </p>
      ) : null}

      {!conn ? (
        <FormSection title={t('title')} description={`${t('intro')} ${t('privacy')}`}>
          <div className="docs-notion-connect" data-testid="notion-sync-disconnected">
            {status.oauth ? (
              <div className="docs-notion-oauth">
                <a className="btn" href="/api/integrations/notion/start" data-testid="notion-sync-oauth">
                  {t('connectOauth')}
                </a>
                <p className="ui-help">{t('oauthHelp')}</p>
              </div>
            ) : (
              <p className="ui-help">{t('oauthMissing')}</p>
            )}
            <form
              className="docs-notion-token"
              onSubmit={(e) => {
                e.preventDefault();
                void connect();
              }}
            >
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-token`}>
                  {t('tokenLabel')}
                </label>
                <input
                  id={`${uid}-token`}
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ntn_…"
                  aria-describedby={`${uid}-token-help`}
                  data-testid="notion-sync-token"
                />
                <p id={`${uid}-token-help`} className="ui-help">
                  {t('tokenHelp')}
                </p>
              </div>
              {connectError ? (
                <p className="ui-error" role="alert">
                  {connectError}
                </p>
              ) : null}
              <div>
                <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !token.trim()} data-testid="notion-sync-connect">
                  {busy ? t('connecting') : t('connectToken')}
                </button>
              </div>
            </form>
          </div>
        </FormSection>
      ) : (
        <>
          <FormSection
            title={t('title')}
            description={t('connectedTo', { name: conn.workspaceName })}
            footer={
              <div className="docs-notion-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void syncNow()} disabled={busy || conn.paused} data-testid="notion-sync-now">
                  {t('syncNow')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void send('PATCH', { paused: !conn.paused })}
                  disabled={busy}
                  data-testid="notion-sync-pause"
                >
                  {conn.paused ? t('resume') : t('pause')}
                </button>
                <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirmOff(true)} disabled={busy} data-testid="notion-sync-disconnect">
                  {t('disconnect')}
                </button>
              </div>
            }
          >
            <div className="docs-notion-state" data-testid="notion-sync-state" data-status={conn.paused ? 'paused' : conn.status}>
              <p className="docs-notion-state-line">
                <span className="st-strong">{conn.paused ? t('state.paused') : t(`state.${conn.status}`)}</span>
                <span className="ui-help">{conn.kind === 'oauth' ? t('viaOauth') : t('viaToken')}</span>
              </p>
              {importing && p.total > 0 ? (
                <>
                  <span className="docs-notion-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={done} aria-label={t('progress', { done, total: p.total })}>
                    <span style={{ width: `${Math.round((done / p.total) * 100)}%` }} />
                  </span>
                  <p className="ui-help" data-testid="notion-sync-progress">
                    {t('progress', { done, total: p.total })}
                  </p>
                </>
              ) : (
                <p className="ui-help" data-testid="notion-sync-progress">
                  {t('summary', { synced: p.synced, total: p.total })}
                  {conn.lastSyncAt ? ` · ${t('lastSync', { time: time(conn.lastSyncAt) })}` : ''}
                </p>
              )}
              {p.errors > 0 ? <p className="ui-error">{t('itemErrors', { count: p.errors })}</p> : null}
              {conn.status === 'error' ? (
                <p className="ui-error" role="alert">
                  {t(conn.error === 'unauthorized' ? 'errors.revoked' : 'errors.failed')}
                </p>
              ) : null}
              {syncNote ? (
                <p className="ui-help" role="status">
                  {syncNote}
                </p>
              ) : null}
              <p className="ui-help">{conn.webhooks ? t('liveWebhooks') : t('livePolling')}</p>
            </div>
          </FormSection>

          <FormSection
            title={t('directionTitle')}
            description={t('directionHelp')}
            onSubmit={async (fd) => {
              const err = await send('PATCH', { direction: fd.get('direction') });
              return err ?? undefined;
            }}
          >
            <div className="docs-notion-choices" role="radiogroup" aria-label={t('directionTitle')}>
              {DIRECTIONS.map((d) => (
                <label key={d} className="docs-notion-choice">
                  <input type="radio" name="direction" value={d} defaultChecked={conn.direction === d} data-testid={`notion-sync-direction-${d}`} />
                  <span className="docs-notion-choice-text">
                    <span className="st-strong">{t(`directions.${d}.title`)}</span>
                    <span className="ui-help">{t(`directions.${d}.help`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </FormSection>

          <FormSection
            title={t('rootsTitle')}
            description={t('rootsHelp')}
            onSubmit={
              status.roots.length
                ? async (fd) => {
                    const roots = status.roots.map((r) => ({ id: r.id, enabled: fd.get(`root-${r.id}`) === 'on' }));
                    return (await send('PATCH', { roots })) ?? undefined;
                  }
                : undefined
            }
          >
            {status.roots.length ? (
              <ul className="docs-notion-roots" data-testid="notion-sync-roots">
                {status.roots.map((r) => (
                  <li key={r.id}>
                    <label className="docs-notion-root">
                      <input type="checkbox" name={`root-${r.id}`} defaultChecked={r.enabled} />
                      <span className="docs-notion-root-title">{r.title || t('untitled')}</span>
                      <span className="ui-help">{r.kind === 'database' ? t('kindDatabase') : t('kindPage')}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ui-help">{conn.status === 'discovering' ? t('rootsLoading') : t('rootsEmpty')}</p>
            )}
          </FormSection>

          <FormSection title={t('logTitle')} description={t('logHelp')}>
            {status.log.length ? (
              <ol className="docs-notion-log" data-testid="notion-sync-log">
                {status.log.map((l) => (
                  <li key={l.id} className="docs-notion-log-row">
                    <span className={`docs-notion-dir is-${l.dir}`}>{t(`dir.${l.dir === 'in' || l.dir === 'out' ? l.dir : 'sys'}`)}</span>
                    <span className="docs-notion-log-main">
                      <span>{KNOWN_ACTIONS.has(l.action) ? t(`actions.${l.action}`) : l.action}</span>
                      {l.title ? (
                        l.pageId ? (
                          <Link href={`/app/docs/${l.pageId}`} className="docs-inline-link docs-notion-log-title">
                            {l.title}
                          </Link>
                        ) : (
                          <span className="docs-notion-log-title">{l.title}</span>
                        )
                      ) : null}
                      {l.detail && (l.action === 'error' || l.action === 'conflict_notion' || l.action === 'conflict_docs') ? (
                        <span className="ui-help docs-notion-log-detail">{l.action === 'error' ? (t.has(`errors.${l.detail}`) ? t(`errors.${l.detail}`) : l.detail) : l.detail}</span>
                      ) : null}
                    </span>
                    <time className="ui-help docs-notion-log-time" dateTime={l.at}>
                      {time(l.at)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ui-help">{t('logEmpty')}</p>
            )}
          </FormSection>
        </>
      )}

      {status.webhookToken !== undefined ? (
        <FormSection title={t('webhookTitle')} description={t('webhookHelp')}>
          <p className="ui-help">
            <code className="docs-notion-code">/api/integrations/notion/webhook</code>
          </p>
          {status.webhookToken ? (
            <div className="docs-notion-webhook">
              <code className="docs-notion-code" data-testid="notion-sync-webhook-token">
                {status.webhookToken}
              </code>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send('PATCH', { clear_webhook_token: true })}>
                {t('webhookClear')}
              </button>
            </div>
          ) : (
            <div className="docs-notion-webhook">
              <p className="ui-help">{status.webhookWaiting ? t('webhookWaiting') : t('webhookIdle')}</p>
              {status.webhookWaiting ? null : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send('PATCH', { open_webhook_window: true })}>
                  {t('webhookOpen')}
                </button>
              )}
            </div>
          )}
        </FormSection>
      ) : null}

      {confirmOff ? (
        <ConfirmDialog
          open
          title={t('disconnectTitle')}
          body={t('disconnectBody')}
          confirmLabel={t('disconnect')}
          cancelLabel={t('cancel')}
          danger
          busy={busy}
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmOff(false)}
        />
      ) : null}
    </>
  );
}
