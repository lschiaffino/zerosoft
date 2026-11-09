'use client';

/**
 * Track › Ajustes › Integraciones › Linear: conectar (Login with Linear o API
 * key), elegir teams y sentido, el import inicial con su progreso y, después,
 * el estado de la sincronización en vivo con pausa, "sincronizar ahora",
 * desconectar y el log con reintentos.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import FormSection from '@/components/ui/FormSection';
import EmptyState from '@/components/ui/EmptyState';
import LocalText from '@/components/ui/LocalText';
import { ImportProgress, type ImportJobView } from '@/components/app/ImportJob';
import type { LinearSyncView } from '@/lib/track-linear-sync';
import type { LinearTeamRef } from '@/lib/track-linear-import';

type View = LinearSyncView & { isAdmin: boolean; availableTeams: LinearTeamRef[] | null };
type Direction = 'two_way' | 'import' | 'push';
const DIRECTIONS: Direction[] = ['two_way', 'import', 'push'];
const CALLBACK_STATUSES = ['connected', 'denied', 'invalid_state', 'failed', 'forbidden', 'not_configured'];

async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

function fmtDate(raw: string, locale: string): string {
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Avanza el import mientras se mira (el cron lo sigue si se cierra la página). */
function useDriveImport(jobId: string | null, onDone: () => void) {
  const [job, setJob] = useState<ImportJobView | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    (async () => {
      for (let fails = 0; alive; ) {
        const res = await send<{ job: ImportJobView | null }>(`/api/import/jobs/${jobId}/run`, 'POST', {}).catch(() => null);
        if (!alive) return;
        if (!res?.ok || !res.data.job) {
          if (++fails >= 5) return;
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        fails = 0;
        setJob(res.data.job);
        if (!['fetching', 'importing', 'preview'].includes(res.data.job.status)) {
          done.current();
          return;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);
  return job;
}

export default function LinearSyncSettings({ locale }: { locale: string }) {
  const t = useTranslations('track');
  const tl = useTranslations('track.integrations.linear');
  const params = useSearchParams();
  const callback = params?.get('linear') ?? null;
  const [data, setData] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [teamsFailed, setTeamsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [teams, setTeams] = useState<string[]>([]);
  const [direction, setDirection] = useState<Direction>('two_way');

  const errorText = useCallback(
    (code: string | undefined | null) => {
      if (code && tl.has(`errors.${code}`)) return tl(`errors.${code}`);
      if (code && tl.has(`errors.linear_${code}`)) return tl(`errors.linear_${code}`);
      return tl('errors.generic');
    },
    [tl],
  );

  const apply = useCallback((v: View) => {
    setData((prev) => ({ ...v, availableTeams: v.availableTeams ?? prev?.availableTeams ?? null }));
    if (v.connection) {
      setTeams(v.connection.teams.map((x) => x.id));
      setDirection(v.connection.direction);
    }
  }, []);

  const load = useCallback(
    async (withTeams: boolean) => {
      setLoadFailed(false);
      const res = await send<View>(`/api/track/integrations/linear${withTeams ? '?teams=1' : ''}`, 'GET').catch(() => null);
      if (!res) {
        setLoadFailed(true);
        return;
      }
      if (!res.ok) {
        // Sin poder leer los teams (key revocada, Linear caído): el estado se muestra igual.
        if (withTeams && res.data.error?.startsWith('linear_')) {
          setTeamsFailed(true);
          setError(errorText(res.data.error));
          const plain = await send<View>('/api/track/integrations/linear', 'GET').catch(() => null);
          if (plain?.ok) apply(plain.data);
          else setLoadFailed(true);
          return;
        }
        setLoadFailed(true);
        return;
      }
      setTeamsFailed(false);
      apply(res.data);
    },
    [apply, errorText],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const importJob = useDriveImport(data?.phase === 'importing' ? data.importJobId : null, () => void load(false));

  const act = async (key: string, fn: () => Promise<{ ok: boolean; data: View & { error?: string } } | null>) => {
    setBusy(key);
    setError(null);
    const res = await fn().catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError(errorText(res?.data?.error));
      return false;
    }
    apply(res.data);
    return true;
  };

  const connectKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError(tl('errors.invalid_key'));
      return;
    }
    const ok = await act('connect', () => send<View>('/api/track/integrations/linear', 'POST', { action: 'connect', apiKey: apiKey.trim() }));
    if (ok) {
      setApiKey('');
      await load(true);
    }
  };

  const saveAndStart = async () => {
    if (!teams.length) {
      setError(tl('errors.linear_no_teams'));
      return;
    }
    const saved = await act('start', () => send<View>('/api/track/integrations/linear', 'PATCH', { teams, direction }));
    if (saved) await act('start', () => send<View>('/api/track/integrations/linear', 'POST', { action: 'start' }));
  };

  const saveLive = async () => {
    const before = new Set(data?.connection?.teams.map((x) => x.id) ?? []);
    const added = teams.some((id) => !before.has(id));
    if (!teams.length) {
      setError(tl('errors.linear_no_teams'));
      return;
    }
    const saved = await act('save', () => send<View>('/api/track/integrations/linear', 'PATCH', { teams, direction }));
    // Un team nuevo entra con su import (lo ya importado se actualiza sin duplicar).
    if (saved && added) await act('save', () => send<View>('/api/track/integrations/linear', 'POST', { action: 'start' }));
  };

  if (loadFailed) {
    return (
      <FormSection title="Linear">
        <EmptyState
          quiet
          title={tl('loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
              {t('common.retry')}
            </button>
          }
        />
      </FormSection>
    );
  }
  if (!data) {
    return (
      <FormSection title="Linear" description={tl('help')}>
        <div className="ui-loading-stack" aria-busy="true" data-testid="track-linear-loading">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-row" />
        </div>
      </FormSection>
    );
  }

  const { isAdmin, connection: conn } = data;
  const callbackNote = callback && CALLBACK_STATUSES.includes(callback) ? tl(`callback.${callback}`) : null;
  const note = (
    <span className="ui-section-note" role={error ? 'alert' : undefined} data-testid="track-linear-note">
      {error ?? (isAdmin ? (callbackNote ?? '') : t('integrations.adminOnly'))}
    </span>
  );

  if (!conn) {
    return (
      <FormSection title="Linear" description={tl('help')} footer={note}>
        <div className="track-settings-block" data-testid="track-linear-connect">
          {isAdmin ? (
            <>
              {data.oauthAvailable ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a className="btn btn-primary" href="/api/integrations/linear/connect" data-testid="track-linear-oauth">
                    {tl('connectOAuth')}
                  </a>
                </div>
              ) : (
                <p className="ui-help">{tl('oauthUnavailable')}</p>
              )}
              <form className="track-int-form" onSubmit={(e) => void connectKey(e)} aria-label={tl('apiKeyTitle')}>
                <div className="ui-field">
                  <label className="label" htmlFor="linear-api-key">
                    {tl('apiKeyLabel')}
                  </label>
                  <input
                    id="linear-api-key"
                    className="input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="lin_api_…"
                  />
                  <p className="ui-help">{tl('apiKeyHelp')}</p>
                </div>
                <div>
                  <button type="submit" className={data.oauthAvailable ? 'btn' : 'btn btn-primary'} disabled={busy === 'connect'} aria-busy={busy === 'connect' || undefined} data-testid="track-linear-connect-key">
                    {busy === 'connect' ? tl('connecting') : tl('connectKey')}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p className="ui-help">{t('integrations.notConnected')}</p>
          )}
        </div>
      </FormSection>
    );
  }

  const available = data.availableTeams ?? conn.teams;
  const phase = data.phase;
  const live = phase === 'live';
  const teamsChanged = teams.slice().sort().join(',') !== conn.teams.map((x) => x.id).sort().join(',') || direction !== conn.direction;

  const statusLine = live
    ? conn.paused
      ? tl('status.paused')
      : tl('status.live', { direction: tl(`directions.${conn.direction}`) })
    : phase === 'error'
      ? tl('status.error', { reason: errorText(data.lastError) })
      : phase === 'importing'
        ? tl('status.importing')
        : tl('status.setup');

  return (
    <FormSection
      title="Linear"
      description={tl('connectedTo', { org: conn.orgName, name: conn.viewerName || conn.orgUrlKey })}
      footer={
        <>
          {note}
          {isAdmin ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy === 'disconnect'}
              onClick={() => {
                if (!window.confirm(tl('disconnectConfirm'))) return;
                void act('disconnect', () => send<View>('/api/track/integrations/linear', 'DELETE')).then(() => load(false));
              }}
              data-testid="track-linear-disconnect"
            >
              {t('integrations.disconnect')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="track-settings-block" data-testid="track-linear-settings" data-phase={phase}>
        <p className="track-linear-status" data-testid="track-linear-status" data-tone={phase === 'error' ? 'bad' : conn.paused ? 'warn' : live ? 'good' : undefined}>
          <span className="track-linear-dot" aria-hidden="true" />
          <span>{statusLine}</span>
        </p>
        {live ? (
          <p className="ui-help" data-testid="track-linear-meta">
            {data.lastSyncAt ? (
              <>
                {tl('lastSync')} <LocalText>{fmtDate(data.lastSyncAt, locale)}</LocalText>
              </>
            ) : (
              tl('never')
            )}
            {' · '}
            {conn.webhookMode === 'none' ? tl('webhook.none') : tl('webhook.live')}
            {data.pending > 0 ? ` · ${tl('pending', { count: data.pending })}` : ''}
            {data.rateLimitedUntil ? (
              <>
                {' · '}
                {tl('rateLimited')} <LocalText>{fmtDate(data.rateLimitedUntil, locale)}</LocalText>
              </>
            ) : null}
          </p>
        ) : null}

        {phase === 'importing' ? <ImportProgress job={importJob} stageLabel={(s) => (t.has(`importer.stages.${s.replace(':', '_')}`) ? t(`importer.stages.${s.replace(':', '_')}`) : null)} /> : null}

        {isAdmin && phase !== 'importing' ? (
          <>
            <fieldset className="track-linear-teams" aria-describedby="linear-teams-help">
              <legend className="label">{tl('teamsTitle')}</legend>
              <p className="ui-help" id="linear-teams-help">
                {tl('teamsHelp')}
              </p>
              {teamsFailed ? (
                <p className="ui-help">{tl('teamsError')}</p>
              ) : data.availableTeams === null ? (
                <p className="ui-help">{tl('teamsLoading')}</p>
              ) : available.length === 0 ? (
                <p className="ui-help">{tl('noTeams')}</p>
              ) : (
                <ul className="track-linear-team-list" data-testid="track-linear-teams">
                  {available.map((team) => (
                    <li key={team.id}>
                      <label className="ui-check">
                        <input
                          type="checkbox"
                          checked={teams.includes(team.id)}
                          onChange={() => setTeams((prev) => (prev.includes(team.id) ? prev.filter((x) => x !== team.id) : [...prev, team.id]))}
                        />
                        <span className="track-linear-team-name">{team.name}</span>
                        <span className="data st-muted">{team.key}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="ui-field track-linear-direction">
              <label className="label" htmlFor="linear-direction">
                {tl('direction')}
              </label>
              <select id="linear-direction" className="select" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {tl(`directions.${d}`)}
                  </option>
                ))}
              </select>
              <p className="ui-help">{tl('conflicts')}</p>
            </div>
            <div className="track-linear-actions">
              {live ? (
                <>
                  <button type="button" className="btn btn-primary" disabled={!teamsChanged || busy === 'save'} aria-busy={busy === 'save' || undefined} onClick={() => void saveLive()} data-testid="track-linear-save">
                    {t('integrations.save')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === 'sync' || conn.paused}
                    aria-busy={busy === 'sync' || undefined}
                    onClick={() => void act('sync', () => send<View>('/api/track/integrations/linear', 'POST', { action: 'sync' }))}
                    data-testid="track-linear-sync-now"
                  >
                    {busy === 'sync' ? tl('syncing') : tl('syncNow')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy === 'pause'}
                    onClick={() => void act('pause', () => send<View>('/api/track/integrations/linear', 'PATCH', { paused: !conn.paused }))}
                    data-testid="track-linear-pause"
                  >
                    {conn.paused ? tl('resume') : tl('pause')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy === 'start' || teamsFailed} aria-busy={busy === 'start' || undefined} onClick={() => void saveAndStart()} data-testid="track-linear-start">
                  {phase === 'error' ? tl('restart') : tl('start')}
                </button>
              )}
            </div>
            {!live ? <p className="ui-help">{tl('startHelp')}</p> : null}
          </>
        ) : null}

        {isAdmin && data.failed.length > 0 ? (
          <>
            <h3 className="track-int-subtitle">{tl('failedTitle')}</h3>
            <ul className="track-int-log" data-testid="track-linear-failed">
              {data.failed.map((f) => (
                <li key={f.id} className="is-error">
                  <span className="data">{f.kind.startsWith('push') ? '→' : '←'}</span>
                  <span className="track-int-log-text">
                    {tl.has(`kinds.${f.kind.replace('.', '_')}`) ? tl(`kinds.${f.kind.replace('.', '_')}`) : f.kind} · {errorText(f.error ? `linear_${f.error}` : null)}
                  </span>
                  <button type="button" className="btn btn-sm" disabled={busy === `retry-${f.id}`} onClick={() => void act(`retry-${f.id}`, () => send<View>('/api/track/integrations/linear', 'POST', { action: 'retry', id: f.id }))}>
                    {tl('retry')}
                  </button>
                </li>
              ))}
            </ul>
            {data.failed.length > 1 ? (
              <div>
                <button type="button" className="btn btn-sm" disabled={busy === 'retry'} onClick={() => void act('retry', () => send<View>('/api/track/integrations/linear', 'POST', { action: 'retry' }))}>
                  {tl('retryAll')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {isAdmin ? (
          <>
            <h3 className="track-int-subtitle">{tl('log')}</h3>
            {data.log.length === 0 ? (
              <p className="ui-help">{t('integrations.logEmpty')}</p>
            ) : (
              <ul className="track-int-log" aria-label={tl('log')} data-testid="track-linear-log">
                {data.log.map((e) => (
                  <li key={e.id} className={e.ok ? undefined : 'is-error'}>
                    <span className="data" aria-label={e.direction === 'in' ? tl('fromLinear') : tl('toLinear')}>
                      {e.direction === 'in' ? '←' : '→'}
                    </span>
                    <span className="track-int-log-text">
                      {tl.has(`events.${e.kind.replace('.', '_')}`) ? `${tl(`events.${e.kind.replace('.', '_')}`)}: ` : ''}
                      {e.summary}
                    </span>
                    <span className="st-muted">
                      <LocalText>{fmtDate(e.createdAt, locale)}</LocalText>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="ui-help">{tl('deleteNote')}</p>
          </>
        ) : null}
      </div>
    </FormSection>
  );
}
