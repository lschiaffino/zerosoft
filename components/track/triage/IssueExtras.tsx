'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { relDate } from '@/lib/utils';
import { REQUEST_SOURCES, sessionIsOpen, type RequestSource } from '@/lib/track-triage-shared';
import type { CustomerRequestDto, CustomerOption } from '@/lib/track-customers';
import { CustomerPicker, RequestRow } from './RequestRow';
import type { AgentSessionDto } from '@/lib/track-agents';
import { Popover } from '../InlineEditors';
import { MarkdownView } from '../MarkdownEditor';
import SlaChip from './SlaChip';
import { aiErrorKey, call, useIssueInsights } from './api';

// ---------- Resumen con IA ----------

function SummaryBlock({ issueId, locale }: { issueId: string; locale: string }) {
  const t = useTranslations('trackTriage');
  const { data, patch } = useIssueInsights(issueId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const { summary, generatedAt } = data.summary;

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await call<{ summary: string; generatedAt: string }>(`/api/track/issues/${issueId}/ai/summary`, { method: 'POST' });
    setBusy(false);
    if (res.ok) patch((p) => ({ ...p, summary: res.data }));
    else setError(t(aiErrorKey(res.error, 'ai.summaryError')));
  };

  return (
    <section className="track-detail-section track-ai-summary" aria-label={t('ai.summary')} data-testid="track-ai-summary">
      <div className="track-x-head">
        <h2 className="track-section-title">{t('ai.summary')}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run()} disabled={busy} aria-busy={busy} data-testid="track-ai-summarize">
          {busy ? t('ai.summarizing') : summary ? t('ai.resummarize') : t('ai.summarize')}
        </button>
      </div>
      {summary ? (
        <>
          <p className="track-ai-summary-text" data-testid="track-ai-summary-text">
            {summary}
          </p>
          {generatedAt && <p className="ui-help">{t('ai.summaryAt', { when: relDate(generatedAt, locale) })}</p>}
        </>
      ) : (
        !error && <p className="ui-help">{t('ai.summaryEmpty')}</p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AddRequestForm({ issueId, onDone, onCancel }: { issueId: string; onDone: (r: CustomerRequestDto) => void; onCancel: () => void }) {
  const t = useTranslations('trackTriage.customers');
  const [picked, setPicked] = useState<CustomerOption | null>(null);
  const [typed, setTyped] = useState('');
  const [important, setImportant] = useState(false);
  const [body, setBody] = useState('');
  const [source, setSource] = useState<RequestSource>('manual');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const free = typed.trim();
    if (!picked && !free) {
      setError(t('missingCustomer'));
      return;
    }
    setBusy(true);
    setError(null);
    const isEmail = /@/.test(free);
    const res = await call<CustomerRequestDto>(`/api/track/issues/${issueId}/customer-requests`, {
      method: 'POST',
      json: {
        companyId: picked?.kind === 'company' ? picked.id : undefined,
        contactId: picked?.kind === 'contact' ? picked.id : undefined,
        customerName: !picked && !isEmail ? free : undefined,
        customerEmail: !picked && isEmail ? free : undefined,
        important,
        body,
        source: picked && source === 'manual' ? 'crm' : source,
        sourceUrl: sourceUrl.trim() || undefined,
      },
    });
    setBusy(false);
    if (res.ok) onDone(res.data);
    else setError(res.error === 'invalid_email' ? t('invalidEmail') : res.error === 'invalid_url' ? t('invalidUrl') : t('error'));
  };

  return (
    <form
      className="track-request-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      data-testid="track-request-form"
    >
      <CustomerPicker
        value={picked}
        autoFocus
        onPick={(o, text) => {
          setPicked(o);
          setTyped(text);
        }}
      />
      <p className="ui-help">{t('orName')}</p>
      <label className="sr-only" htmlFor={`rq-body-${issueId}`}>
        {t('quote')}
      </label>
      <textarea
        id={`rq-body-${issueId}`}
        className="textarea"
        rows={3}
        maxLength={5000}
        placeholder={t('quotePlaceholder')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        data-testid="track-request-body"
      />
      <div className="track-request-form-row">
        <label className="ui-check">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} data-testid="track-request-important-input" />
          {t('important')}
        </label>
        <label className="track-request-source">
          <span className="sr-only">{t('source')}</span>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as RequestSource)} aria-label={t('source')}>
            {REQUEST_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <input
          className="input track-request-url"
          type="url"
          inputMode="url"
          placeholder={t('sourceUrlPlaceholder')}
          aria-label={t('sourceUrl')}
          value={sourceUrl}
          maxLength={1000}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="track-inline-form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} data-testid="track-request-save">
          {t('save')}
        </button>
      </div>
    </form>
  );
}

function RequestsBlock({ issueId, locale }: { issueId: string; locale: string }) {
  const t = useTranslations('trackTriage.customers');
  const { data, patch, error } = useIssueInsights(issueId);
  const [adding, setAdding] = useState(false);
  if (error && !data) return null;
  if (!data) return null;
  const rows = data.requests;
  const count = new Set(rows.map((r) => r.companyId ?? r.contactId ?? r.email ?? r.customer)).size;

  return (
    <section className="track-detail-section track-requests" aria-label={t('title')} data-testid="track-requests">
      <div className="track-x-head">
        <h2 className="track-section-title">
          {t('title')}
          {rows.length > 0 && <span className="ui-tab-count">{count}</span>}
        </h2>
        {!adding && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} data-testid="track-request-add">
            <span aria-hidden>+</span> {t('add')}
          </button>
        )}
      </div>
      {rows.length === 0 && !adding && <p className="ui-help">{t('empty')}</p>}
      {rows.length > 0 && (
        <ul className="track-request-list">
          {rows.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              locale={locale}
              onChange={(next) =>
                patch((p) => ({ ...p, requests: next ? p.requests.map((x) => (x.id === r.id ? next : x)) : p.requests.filter((x) => x.id !== r.id) }))
              }
            />
          ))}
        </ul>
      )}
      {adding && (
        <AddRequestForm
          issueId={issueId}
          onCancel={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            patch((p) => ({ ...p, requests: [...p.requests, r] }));
          }}
        />
      )}
    </section>
  );
}

// ---------- Agentes ----------

function SessionView({ s, locale, onChange }: { s: AgentSessionDto; locale: string; onChange: () => void }) {
  const t = useTranslations('trackTriage.agents');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const open = s.state !== 'stopped';

  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    setError(false);
    const res = await call(`/api/track/agent-sessions/${s.id}`, { method: 'POST', json: { body: reply.trim() } });
    setBusy(false);
    if (res.ok) {
      setReply('');
      onChange();
    } else setError(true);
  };
  const stop = async () => {
    setBusy(true);
    await call(`/api/track/agent-sessions/${s.id}`, { method: 'DELETE' });
    setBusy(false);
    onChange();
  };

  return (
    <div className="track-agent-session" data-testid="track-agent-session" data-state={s.state}>
      <div className="track-agent-head">
        <span className="track-agent-name">{s.agentName}</span>
        <span className={`track-agent-state is-${s.state}`} data-testid="track-agent-state">
          {t(`states.${s.state}`)}
        </span>
        {s.externalUrl && (
          <a href={s.externalUrl} target="_blank" rel="noreferrer" className="track-request-meta">
            {t('openExternal')}
          </a>
        )}
        {sessionIsOpen(s.state) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void stop()} disabled={busy} data-testid="track-agent-stop">
            {t('stop')}
          </button>
        )}
      </div>
      <ol className="track-agent-activities">
        {s.activities.map((a) => (
          <li key={a.id} className={`track-agent-activity is-${a.type}`} data-testid="track-agent-activity" data-type={a.type}>
            <span className="track-agent-activity-type">{a.type === 'prompt' ? a.userName ?? t('types.prompt') : t(`types.${a.type}`)}</span>
            <div className="track-agent-activity-body">
              {a.type === 'response' || a.type === 'prompt' ? <MarkdownView source={a.body} /> : <p>{a.body}</p>}
            </div>
            <time className="track-request-meta" dateTime={a.createdAt}>
              {relDate(a.createdAt, locale)}
            </time>
          </li>
        ))}
        {s.activities.length === 0 && <li className="ui-help">{t('starting')}</li>}
      </ol>
      {open && (
        <form
          className="track-agent-reply"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`reply-${s.id}`}>
            {t('reply')}
          </label>
          <input
            id={`reply-${s.id}`}
            className="input"
            value={reply}
            maxLength={4000}
            onChange={(e) => setReply(e.target.value)}
            placeholder={s.state === 'awaiting_input' ? t('answerPlaceholder') : t('replyPlaceholder')}
            data-testid="track-agent-reply"
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !reply.trim()} data-testid="track-agent-send">
            {t('send')}
          </button>
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}

function AgentBlock({ issueId, locale, onIssueChange }: { issueId: string; locale: string; onIssueChange?: () => void }) {
  const t = useTranslations('trackTriage.agents');
  const { data, reload } = useIssueInsights(issueId);
  const [showOld, setShowOld] = useState(false);
  const sessions = data?.sessions ?? [];
  const current = sessions.find((s) => sessionIsOpen(s.state)) ?? null;
  const head = sessions[0] ?? null;
  const working = Boolean(head && (head.state === 'pending' || head.state === 'active'));
  const key = head ? `${head.id}:${head.state}:${head.activities.length}` : '';
  const seen = useRef<string | null>(null);
  const changed = useRef(onIssueChange);
  changed.current = onIssueChange;

  // Mientras el agente trabaja, se refresca hasta que responde.
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => void reload(), 2000);
    return () => clearInterval(id);
  }, [working, reload]);

  // Cuando la sesión avanza (respondió, preguntó o falló), el issue puede haber cambiado de estado.
  useEffect(() => {
    if (!data) return;
    if (seen.current !== null && seen.current !== key && !working) changed.current?.();
    seen.current = key;
  }, [data, key, working]);

  if (!data || sessions.length === 0) return null;
  const latest = current ?? sessions[0];
  const older = sessions.filter((s) => s.id !== latest.id);

  return (
    <section className="track-detail-section" aria-label={t('session')} data-testid="track-agent-block">
      <h2 className="track-section-title">{t('session')}</h2>
      <SessionView s={latest} locale={locale} onChange={() => void reload().then(() => onIssueChange?.())} />
      {older.length > 0 && (
        <>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
            {t('history', { count: older.length })}
          </button>
          {showOld && older.map((s) => <SessionView key={s.id} s={s} locale={locale} onChange={() => void reload()} />)}
        </>
      )}
    </section>
  );
}

/** Bloques de la columna principal del issue: resumen IA, pedidos de clientes y sesión del agente. */
export function IssueMainExtras({ issueId, locale, onIssueChange }: { issueId: string; locale: string; onIssueChange?: () => void }) {
  return (
    <>
      <SummaryBlock issueId={issueId} locale={locale} />
      <RequestsBlock issueId={issueId} locale={locale} />
      <AgentBlock issueId={issueId} locale={locale} onIssueChange={onIssueChange} />
    </>
  );
}

/** Propiedades del panel lateral: SLA y agente (delegate). */
export function IssueSideExtras({ issueId, watch }: { issueId: string; watch?: string }) {
  const t = useTranslations('trackTriage');
  const { data, reload } = useIssueInsights(issueId);
  const [error, setError] = useState<string | null>(null);
  // Cambió la prioridad o el estado: el SLA se recalcula en el servidor.
  const seen = useRef(watch);
  useEffect(() => {
    if (seen.current === watch) return;
    seen.current = watch;
    void reload();
  }, [watch, reload]);
  if (!data) return null;
  // El delegate sigue siendo el agente de la última sesión hasta que se lo quita (como en Linear).
  const current = data.sessions.find((s) => s.state !== 'stopped') ?? null;

  const delegate = async (kind: string, agentId: string) => {
    setError(null);
    const res = await call(`/api/track/issues/${issueId}/agent`, { method: 'POST', json: { kind, agentId } });
    if (res.ok) void reload();
    else setError(t('agents.error'));
  };
  const remove = async () => {
    await call(`/api/track/issues/${issueId}/agent`, { method: 'DELETE' });
    void reload();
  };

  return (
    <dl className="track-x-props" data-testid="track-side-extras">
      {(data.slaEnabled || data.sla) && (
        <div className="track-x-prop">
          <dt>{t('sla.label')}</dt>
          <dd data-testid="track-issue-sla">
            {data.sla ? (
              data.sla.completedAt ? (
                <SlaChip dueAt={data.sla.dueAt} riskAt={data.sla.riskAt} completedAt={data.sla.completedAt} />
              ) : (
                <SlaChip dueAt={data.sla.dueAt} riskAt={data.sla.riskAt} />
              )
            ) : (
              <span className="track-x-muted">{t('sla.none')}</span>
            )}
          </dd>
        </div>
      )}
      <div className="track-x-prop">
        <dt>{t('agents.label')}</dt>
        <dd>
          <Popover
            ariaLabel={t('agents.delegate')}
            width={240}
            trigger={
              <span data-testid="track-agent-trigger" className={current ? undefined : 'track-x-muted'}>
                {current ? current.agentName : t('agents.none')}
              </span>
            }
          >
            {(close) => (
              <>
                {data.agents.length === 0 && <p className="ui-help track-x-menu-note">{t('agents.noAgents')}</p>}
                {data.agents.map((a) => (
                  <button
                    key={`${a.kind}:${a.id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current?.agentId === a.id}
                    className="track-menu-item"
                    onClick={() => {
                      close();
                      void delegate(a.kind, a.id);
                    }}
                    data-testid="track-agent-option"
                  >
                    <span className="track-menu-label">{a.name}</span>
                    {a.kind === 'external' && <span className="track-menu-meta">{t('agents.external')}</span>}
                  </button>
                ))}
                {current && (
                  <button
                    type="button"
                    role="menuitem"
                    className="track-menu-item"
                    onClick={() => {
                      close();
                      void remove();
                    }}
                  >
                    <span className="track-menu-label">{t('agents.remove')}</span>
                  </button>
                )}
              </>
            )}
          </Popover>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </dd>
      </div>
    </dl>
  );
}
