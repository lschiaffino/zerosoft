'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import type { EnrichOutput, OutreachOutput, RunItemView, RunView } from '@/lib/crm-ai-agents';
import { aiErrorKey } from './aiShared';

interface RunData {
  run: RunView;
  items: RunItemView[];
}

const FIELD_KEYS = new Set(['industry', 'employees', 'city', 'country', 'phone', 'firstName', 'lastName', 'companyId']);

function recordHref(item: RunItemView): string {
  return item.entity === 'company' ? `/app/crm/companies/${item.entityId}` : `/app/crm/contacts/${item.entityId}`;
}

/**
 * Una corrida de un agente: progreso, los cambios o borradores por registro
 * y las acciones (aplicar, editar y enviar, descartar). Mientras corre, la
 * página avanza la corrida y se actualiza sola.
 */
export default function AiRunView({ initial }: { initial: RunData }) {
  const t = useTranslations('crm.ai');
  const tc = useTranslations('crm');
  const router = useRouter();
  const [data, setData] = useState<RunData>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(initial.run.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stepping = useRef(false);
  const { run, items } = data;

  const step = useCallback(async () => {
    if (stepping.current) return;
    stepping.current = true;
    const res = await fetch(`/api/crm/ai/runs/${run.id}/step`, { method: 'POST' }).catch(() => null);
    stepping.current = false;
    const json = (await res?.json().catch(() => null)) as RunData | null;
    if (res?.ok && json?.run) setData(json);
  }, [run.id]);

  useEffect(() => {
    if (run.status !== 'running') return;
    void step();
    const id = window.setInterval(() => void step(), 2500);
    return () => window.clearInterval(id);
  }, [run.status, step]);

  function patchItem(updated: RunItemView) {
    setData((d) => ({
      run: { ...d.run, ready: d.items.filter((i) => (i.id === updated.id ? updated.status : i.status) === 'ready').length },
      items: d.items.map((i) => (i.id === updated.id ? updated : i)),
    }));
  }

  async function itemAction(item: RunItemView, action: 'apply' | 'send' | 'skip') {
    setBusyId(item.id);
    setError(null);
    const draft = drafts[item.id];
    // Si se editó el borrador, primero se guarda.
    if (action === 'send' && draft) {
      const saved = await fetch(`/api/crm/ai/runs/${run.id}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      }).catch(() => null);
      if (!saved?.ok) {
        setBusyId(null);
        setError(t('errors.generic'));
        return;
      }
    }
    const res =
      action === 'skip'
        ? await fetch(`/api/crm/ai/runs/${run.id}/items/${item.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'skipped' }),
          }).catch(() => null)
        : await fetch(`/api/crm/ai/runs/${run.id}/items/${item.id}/${action}`, { method: 'POST' }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as (RunItemView & { error?: string }) | null;
    setBusyId(null);
    if (!res?.ok || !json?.id) {
      setError(t(aiErrorKey(json?.error)));
      return;
    }
    patchItem(json);
    if (action !== 'skip') router.refresh();
  }

  async function applyAll() {
    setBusyId('all');
    setError(null);
    const res = await fetch(`/api/crm/ai/runs/${run.id}/apply-all`, { method: 'POST' }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as (RunData & { applied?: number }) | null;
    setBusyId(null);
    if (!res?.ok || !json?.run) {
      setError(t('errors.generic'));
      return;
    }
    setData({ run: json.run, items: json.items });
    router.refresh();
  }

  async function patchRun(body: Record<string, unknown>) {
    const res = await fetch(`/api/crm/ai/runs/${run.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as RunView | null;
    if (!res?.ok || !json?.id) {
      setError(t('errors.generic'));
      return null;
    }
    setData((d) => ({ ...d, run: json }));
    router.refresh();
    return json;
  }

  async function saveName() {
    setEditingName(false);
    const next = name.trim();
    if (!next || next === run.name) {
      setName(run.name);
      return;
    }
    await patchRun({ name: next });
  }

  async function remove() {
    const res = await fetch(`/api/crm/ai/runs/${run.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return;
    }
    router.push('/app/crm/agents');
    router.refresh();
  }

  const pct = run.total ? Math.round((run.processed / run.total) * 100) : 0;
  const isOutreach = run.agent === 'outreach';

  return (
    <>
      <PageHeader
        back={{ href: '/app/crm/agents', label: t('agents.title') }}
        title={
          editingName ? (
            <input
              className="input ai-run-name-input"
              value={name}
              autoFocus
              maxLength={120}
              aria-label={t('agents.rename')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName();
                if (e.key === 'Escape') {
                  setName(run.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            run.name
          )
        }
        description={t(`agents.kinds.${run.agent}.desc`)}
        actions={
          <>
            {!editingName && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingName(true)}>
                {t('agents.rename')}
              </button>
            )}
            {run.status === 'running' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void patchRun({ status: 'cancelled' })}>
                {t('agents.cancel')}
              </button>
            )}
            {confirmDelete ? (
              <>
                <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={remove}>
                  {tc('common.delete')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                  {tc('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
                {tc('common.delete')}
              </button>
            )}
          </>
        }
      />

      <div className="ai-run-status">
        <span className={`badge ai-status-${run.status}`}>{t(`agents.status.${run.status}`)}</span>
        <span className="num" data-testid="ai-run-progress">
          {t('agents.progress', { done: run.processed, total: run.total })}
        </span>
        <div className="ai-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('agents.cols.progress')}>
          <span style={{ width: `${pct}%` }} />
        </div>
        {!isOutreach && run.ready > 0 && (
          <button type="button" className="btn btn-primary btn-sm" onClick={applyAll} disabled={busyId !== null}>
            {t('agents.applyAll', { count: run.ready })}
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="muted">{t('agents.noItems')}</p>
      ) : (
        <ul className="ai-items">
          {items.map((item) => {
            const out = item.output as Partial<EnrichOutput & OutreachOutput>;
            const draft = drafts[item.id] ?? { subject: out.subject ?? '', body: out.body ?? '' };
            return (
              <li key={item.id} className={`ai-item ai-item-${item.status}`} data-testid="ai-run-item">
                <div className="ai-item-head">
                  <Link href={recordHref(item)} className="ai-item-name">
                    {item.label}
                  </Link>
                  <span className={`badge ai-item-status-${item.status}`}>{t(`agents.itemStatus.${item.status}`)}</span>
                </div>
                {item.status === 'pending' && <p className="muted">{t('agents.waiting')}</p>}
                {item.status === 'failed' && <p className="form-error">{t(aiErrorKey(item.error))}</p>}
                {!isOutreach && Array.isArray(out.changes) && out.changes.length > 0 && (
                  <dl className="ai-changes">
                    {out.changes.map((ch) => (
                      <div key={ch.field}>
                        <dt>{FIELD_KEYS.has(ch.field) ? t(`agents.fields.${ch.field}`) : ch.field}</dt>
                        <dd>{ch.field === 'companyId' ? (out.source ?? String(ch.value)) : String(ch.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!isOutreach && item.status === 'skipped' && (!out.changes || out.changes.length === 0) && (
                  <p className="muted">{t('agents.nothingFound')}</p>
                )}
                {isOutreach && (item.status === 'ready' || item.status === 'sent') && (
                  <div className="ai-draft">
                    <p className="muted">
                      {t('agents.to')} {out.to}
                    </p>
                    {item.status === 'ready' ? (
                      <>
                        <label className="label" htmlFor={`subj-${item.id}`}>
                          {tc('common.subject')}
                        </label>
                        <input
                          id={`subj-${item.id}`}
                          className="input"
                          value={draft.subject}
                          maxLength={500}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, subject: e.target.value } }))}
                        />
                        <label className="label" htmlFor={`body-${item.id}`}>
                          {tc('common.body')}
                        </label>
                        <textarea
                          id={`body-${item.id}`}
                          className="textarea"
                          rows={6}
                          maxLength={5000}
                          value={draft.body}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: { ...draft, body: e.target.value } }))}
                        />
                      </>
                    ) : (
                      <>
                        <p className="ai-draft-subject">{out.subject}</p>
                        <p className="ai-text">{out.body}</p>
                      </>
                    )}
                  </div>
                )}
                {item.status === 'ready' && (
                  <div className="ai-actions">
                    {isOutreach ? (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => itemAction(item, 'send')} disabled={busyId !== null}>
                        {busyId === item.id ? t('working') : t('agents.send')}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => itemAction(item, 'apply')} disabled={busyId !== null}>
                        {busyId === item.id ? t('working') : t('agents.apply')}
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => itemAction(item, 'skip')} disabled={busyId !== null}>
                      {t('agents.skip')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
