'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalDate from '@/components/ui/LocalDate';
import type { SecurityEventDto, SessionDto } from '@/lib/account-security';

interface WorkspaceSecurity {
  id: string;
  name: string;
  isOwner: boolean;
  requireMfa: boolean;
  withoutMfa: Array<{ id: string; email: string; name: string | null }>;
  events: SecurityEventDto[];
}

async function post(url: string, body: unknown, method = 'POST'): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const data = ((await res?.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, data };
}

/** Ajustes › Seguridad (ver app/[locale]/app/settings/security/page.tsx). */
export default function SecuritySettings(props: {
  locale: string;
  mfaEnabledAt: string | null;
  recoveryLeft: number;
  requiredBy: string | null;
  sessions: SessionDto[];
  activity: SecurityEventDto[];
  workspace: WorkspaceSecurity | null;
}) {
  const t = useTranslations('settings.security');
  return (
    <div className="st-stack" data-testid="security-settings">
      {props.requiredBy !== null && (
        <p className="st-callout" role="status" data-testid="mfa-required">
          {t('requiredBy', { workspace: props.requiredBy })}
        </p>
      )}
      <MfaSection enabledAt={props.mfaEnabledAt} recoveryLeft={props.recoveryLeft} locale={props.locale} />
      <SessionsSection sessions={props.sessions} locale={props.locale} />
      {props.workspace && <WorkspaceSection ws={props.workspace} locale={props.locale} />}
      <FormSection title={t('activity.title')} description={t('activity.desc')}>
        <EventsTable rows={props.activity} locale={props.locale} showActor={false} empty={t('activity.empty')} />
      </FormSection>
    </div>
  );
}

// ---------- Dos pasos ----------

function CodeForm({ label, submitLabel, danger, onSubmit, testId }: { label: string; submitLabel: string; danger?: boolean; onSubmit: (code: string) => Promise<string | null>; testId: string }) {
  const t = useTranslations('settings.security');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(code.trim());
    setBusy(false);
    if (err) setError(err);
    else setCode('');
  }
  return (
    <form className="ui-field st-mfa-code" onSubmit={submit} data-testid={testId}>
      <label className="label" htmlFor={`${testId}-input`}>
        {label}
      </label>
      <div className="st-actions">
        <input
          id={`${testId}-input`}
          className="input st-mfa-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode="text"
          maxLength={14}
          placeholder="123456"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${testId}-error` : undefined}
        />
        <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || code.trim().length < 6} aria-busy={busy || undefined}>
          {busy ? t('working') : submitLabel}
        </button>
      </div>
      {error && (
        <p className="ui-error" role="alert" id={`${testId}-error`}>
          {error}
        </p>
      )}
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('settings.security.mfa');
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="st-block" data-testid="recovery-codes">
      <p className="st-subtitle">{t('codesTitle')}</p>
      <p className="st-muted">{t('codesHelp')}</p>
      <pre className="st-codes data">{text}</pre>
      <div className="st-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined);
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
        <a className="btn btn-secondary" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`zerosoft recovery codes\n\n${text}\n`)}`} download="zerosoft-recovery-codes.txt">
          {t('download')}
        </a>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          {t('saved')}
        </button>
      </div>
    </div>
  );
}

function MfaSection({ enabledAt, recoveryLeft, locale }: { enabledAt: string | null; recoveryLeft: number; locale: string }) {
  const t = useTranslations('settings.security.mfa');
  const tErr = useTranslations('settings.security.errors');
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [signInAgain, setSignInAgain] = useState(false);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const errorText = (status: number, data: Record<string, unknown>) => {
    const code = String(data.error ?? '');
    if (code === 'invalid_code') return tErr('invalidCode');
    if (code === 'rate_limited') return tErr('rateLimited');
    if (code === 'required_by_workspace') return tErr('requiredByWorkspace');
    return status ? tErr('generic') : tErr('network');
  };

  if (codes) {
    return (
      <FormSection title={t('title')} description={t('desc')}>
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            if (signInAgain) window.location.assign(`/${locale}/auth/signin`);
            else router.refresh();
          }}
        />
      </FormSection>
    );
  }

  if (enabledAt) {
    return (
      <FormSection title={t('title')} description={t('desc')}>
        <div className="st-block" data-testid="mfa-on">
          <p>
            <span className="badge badge-ok">{t('on')}</span>{' '}
            <span className="st-muted">
              {t('onSince')} <LocalDate value={enabledAt} locale={locale} kind="date" />
            </span>
          </p>
          <p className={recoveryLeft <= 3 ? 'st-bad' : 'st-muted'}>{t('recoveryLeft', { count: recoveryLeft })}</p>
          {mode === 'idle' && (
            <div className="st-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setMode('regenerate')}>
                {t('regenerate')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setMode('disable')} data-testid="mfa-disable-open">
                {t('disable')}
              </button>
            </div>
          )}
          {mode !== 'idle' && (
            <>
              <CodeForm
                testId={mode === 'disable' ? 'mfa-disable' : 'mfa-regenerate'}
                label={t('confirmWithCode')}
                submitLabel={mode === 'disable' ? t('disable') : t('regenerate')}
                danger={mode === 'disable'}
                onSubmit={async (code) => {
                  const res = await post('/api/account/mfa', { action: mode === 'disable' ? 'disable' : 'recovery', code });
                  if (!res.ok) return errorText(res.status, res.data);
                  setMode('idle');
                  if (Array.isArray(res.data.recoveryCodes)) setCodes(res.data.recoveryCodes as string[]);
                  else router.refresh();
                  return null;
                }}
              />
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
                  {t('cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </FormSection>
    );
  }

  return (
    <FormSection title={t('title')} description={t('desc')}>
      {!setup ? (
        <div className="st-block" data-testid="mfa-off">
          <p className="st-muted">{t('offHelp')}</p>
          <div className="st-actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="mfa-start"
              disabled={starting}
              aria-busy={starting || undefined}
              onClick={async () => {
                setStarting(true);
                setStartError(null);
                const res = await post('/api/account/mfa', { action: 'start' });
                setStarting(false);
                if (!res.ok) return setStartError(errorText(res.status, res.data));
                setSetup({ secret: String(res.data.secret), qr: String(res.data.qr) });
              }}
            >
              {t('setUp')}
            </button>
          </div>
          {startError && (
            <p className="ui-error" role="alert">
              {startError}
            </p>
          )}
        </div>
      ) : (
        <div className="st-block st-mfa-setup" data-testid="mfa-setup">
          <ol className="st-steps">
            <li>{t('step1')}</li>
            <li>{t('step2')}</li>
          </ol>
          <div className="st-mfa-qr" aria-label={t('qrLabel')} role="img" dangerouslySetInnerHTML={{ __html: setup.qr }} />
          <p className="st-muted">{t('manual')}</p>
          <code className="data st-mfa-secret" data-testid="mfa-secret">
            {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
          <CodeForm
            testId="mfa-confirm"
            label={t('step3')}
            submitLabel={t('turnOn')}
            onSubmit={async (code) => {
              const res = await post('/api/account/mfa', { action: 'confirm', code });
              if (!res.ok) return errorText(res.status, res.data);
              setSetup(null);
              setSignInAgain(res.data.signInAgain === true);
              setCodes((res.data.recoveryCodes as string[]) ?? []);
              return null;
            }}
          />
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </FormSection>
  );
}

// ---------- Sesiones ----------

function SessionsSection({ sessions: initial, locale }: { sessions: SessionDto[]; locale: string }) {
  const t = useTranslations('settings.security.sessions');
  const [sessions, setSessions] = useState(initial);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const others = sessions.filter((s) => !s.current).length;

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    const res = await post('/api/account/sessions', { id }, 'DELETE');
    setBusy(null);
    if (!res.ok) return setError(t('error'));
    const was = sessions.find((s) => s.id === id);
    setSessions((list) => list.filter((s) => s.id !== id));
    if (was?.current) window.location.assign(`/${locale}/auth/signin`);
  }

  return (
    <FormSection
      title={t('title')}
      description={t('desc')}
      footer={
        <div className="st-actions">
          <button type="button" className="btn btn-secondary" disabled={!others || busy !== null} onClick={() => setConfirmOthers(true)} data-testid="sessions-revoke-others">
            {t('revokeOthers')}
          </button>
        </div>
      }
    >
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {sessions.length === 0 ? (
        <p className="st-muted">{t('empty')}</p>
      ) : (
        <ul className="st-sessions" data-testid="sessions-list">
          {sessions.map((s) => (
            <li key={s.id} className="st-session">
              <div className="st-session-main">
                <span className="st-strong">{s.device || t('unknownDevice')}</span>
                {s.current && <span className="badge badge-ink">{t('current')}</span>}
                <span className="st-muted st-session-meta">
                  {t(`method.${s.method || 'other'}`)}
                  {s.ip ? ` · ${s.ip}` : ''}
                  {' · '}
                  {t('lastSeen')} <LocalDate value={s.lastSeenAt} locale={locale} />
                </span>
              </div>
              <button type="button" className="btn btn-ghost" disabled={busy !== null} aria-busy={busy === s.id || undefined} onClick={() => void revoke(s.id)}>
                {s.current ? t('signOutHere') : t('revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmOthers}
        title={t('confirmTitle')}
        body={t('confirmBody', { count: others })}
        confirmLabel={t('revokeOthers')}
        cancelLabel={t('cancel')}
        danger
        busy={busy === 'others'}
        onCancel={() => setConfirmOthers(false)}
        onConfirm={async () => {
          setBusy('others');
          const res = await post('/api/account/sessions', { others: true }, 'DELETE');
          setBusy(null);
          setConfirmOthers(false);
          if (!res.ok) return setError(t('error'));
          setSessions((list) => list.filter((s) => s.current));
        }}
      />
    </FormSection>
  );
}

// ---------- Workspace ----------

function WorkspaceSection({ ws, locale }: { ws: WorkspaceSecurity; locale: string }) {
  const t = useTranslations('settings.security.workspace');
  const tErr = useTranslations('settings.security.errors');
  const router = useRouter();
  const [requireMfa, setRequireMfa] = useState(ws.requireMfa);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState(ws.events);
  const [more, setMore] = useState(ws.events.length >= 50);
  const [loading, setLoading] = useState(false);

  async function toggle(next: boolean) {
    setSaving(true);
    setError(null);
    const res = await post('/api/account/audit', { requireMfa: next, workspaceId: ws.id }, 'PATCH');
    setSaving(false);
    if (!res.ok) return setError(res.data.error === 'enable_mfa_first' ? tErr('enableFirst') : tErr('generic'));
    setRequireMfa(next);
    router.refresh();
  }

  async function loadMore() {
    const last = events[events.length - 1];
    if (!last) return;
    setLoading(true);
    const res = await fetch(`/api/account/audit?before=${encodeURIComponent(last.createdAt)}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { events?: SecurityEventDto[] } | null;
    setLoading(false);
    if (!data?.events) return setError(tErr('generic'));
    setEvents((list) => [...list, ...data.events!]);
    setMore(data.events.length >= 50);
  }

  return (
    <>
      <FormSection title={t('title', { workspace: ws.name })} description={t('desc')}>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={requireMfa}
            disabled={!ws.isOwner || saving}
            onChange={(e) => void toggle(e.target.checked)}
            data-testid="require-mfa"
          />
          {t('requireMfa')}
        </label>
        <p className="ui-help">{ws.isOwner ? t('requireMfaHelp') : t('ownerOnly')}</p>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {ws.withoutMfa.length > 0 ? (
          <details className="st-without-mfa">
            <summary>{t('withoutMfa', { count: ws.withoutMfa.length })}</summary>
            <ul>
              {ws.withoutMfa.map((m) => (
                <li key={m.id} className="data">
                  {m.name ? `${m.name} · ` : ''}
                  {m.email}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="st-muted">{t('allHaveMfa')}</p>
        )}
      </FormSection>
      <FormSection
        title={t('auditTitle')}
        description={t('auditDesc')}
        footer={
          <div className="st-actions">
            <a className="btn btn-secondary" href="/api/account/audit?format=csv" download data-testid="audit-csv">
              {t('downloadCsv')}
            </a>
            {more && (
              <button type="button" className="btn btn-ghost" disabled={loading} aria-busy={loading || undefined} onClick={() => void loadMore()}>
                {t('loadMore')}
              </button>
            )}
          </div>
        }
      >
        <EventsTable rows={events} locale={locale} showActor empty={t('auditEmpty')} />
      </FormSection>
    </>
  );
}

function EventsTable({ rows, locale, showActor, empty }: { rows: SecurityEventDto[]; locale: string; showActor: boolean; empty: string }) {
  const t = useTranslations('settings.security.events');
  if (!rows.length) return <p className="st-muted">{empty}</p>;
  const label = (r: SecurityEventDto) => {
    const key = `actions.${r.action.replace(/\./g, '_')}`;
    return t.has(key) ? t(key) : r.action;
  };
  return (
    <div className="table-wrap st-table-stack" data-testid="security-events">
      <table className="table st-events">
        <thead>
          <tr>
            <th scope="col">{t('time')}</th>
            {showActor && <th scope="col">{t('actor')}</th>}
            <th scope="col">{t('action')}</th>
            <th scope="col">{t('detail')}</th>
            <th scope="col">{t('ip')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.source}-${r.id}`}>
              <td className="data st-event-time" data-label={t('time')}>
                <LocalDate value={r.createdAt} locale={locale} />
              </td>
              {showActor && (
                <td className="st-cell-clip" data-label={t('actor')}>
                  {r.actorEmail}
                </td>
              )}
              <td className="st-event-action" data-label={t('action')}>
                {label(r)}
              </td>
              <td className="st-cell-clip" data-label={t('detail')}>
                {r.target || detail(r)}
              </td>
              <td className="data" data-label={t('ip')}>
                {r.ip ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function detail(r: SecurityEventDto): string {
  const m = r.meta;
  if (typeof m.method === 'string') return m.method;
  if (typeof m.on === 'boolean') return m.on ? 'on' : 'off';
  if (typeof m.count === 'number') return String(m.count);
  return '';
}
