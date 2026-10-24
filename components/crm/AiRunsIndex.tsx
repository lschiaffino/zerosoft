'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import type { AiAgent, RunView } from '@/lib/crm-ai-agents';
import CrmIcon from './CrmIcon';
import { aiErrorKey, formatAiWhen } from './aiShared';

const AGENTS: AiAgent[] = ['enrich_companies', 'enrich_contacts', 'outreach'];

interface ListOption {
  id: string;
  name: string;
  count: number;
}

/**
 * Agentes de IA del CRM: qué hace cada uno, el alta de una corrida y la
 * lista de corridas (abrir, renombrar, borrar).
 */
export default function AiRunsIndex({
  title,
  locale,
  runs: initialRuns,
  lists,
  available,
  openNew,
}: {
  title: string;
  locale: string;
  runs: RunView[];
  lists: ListOption[];
  available: boolean;
  openNew: boolean;
}) {
  const t = useTranslations('crm.ai');
  const tc = useTranslations('crm');
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [creating, setCreating] = useState(openNew);
  const [agent, setAgent] = useState<AiAgent>('enrich_companies');
  const [listId, setListId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  useKeyShortcut('c', () => setCreating(true), !creating);

  useEffect(() => setRuns(initialRuns), [initialRuns]);

  function startNew(a: AiAgent) {
    setAgent(a);
    setError(null);
    setCreating(true);
  }

  async function create() {
    if (agent === 'outreach' && !listId) {
      setError(t('agents.needList'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/ai/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agent,
        listId: listId || undefined,
        instructions: agent === 'outreach' ? instructions.trim() || undefined : undefined,
        locale,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (RunView & { error?: string }) | null;
    setBusy(false);
    if (!res?.ok || !data?.id) {
      setError(t(aiErrorKey(data?.error)));
      return;
    }
    setCreating(false);
    router.push(`/app/crm/agents/${data.id}`);
  }

  async function rename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/crm/ai/runs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) {
      setRowError(t('errors.generic'));
      return;
    }
    setRuns((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)));
    setRenamingId(null);
    setRowError(null);
    router.refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/crm/ai/runs/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setRowError(t('errors.generic'));
      return;
    }
    setRuns((rs) => rs.filter((r) => r.id !== id));
    setConfirmingId(null);
    setRowError(null);
    router.refresh();
  }

  const needsAi = agent !== 'enrich_contacts';

  return (
    <>
      <PageHeader
        title={title}
        description={t('agents.desc')}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => startNew(agent)}>
            {t('agents.new')}
            <kbd className="kbd" aria-hidden>
              C
            </kbd>
          </button>
        }
      />

      {!available && (
        <p className="ai-banner" role="note">
          {t('agents.aiOff')}
        </p>
      )}

      <ul className="ai-agent-cards">
        {AGENTS.map((a) => (
          <li key={a} className="ai-agent-card">
            <h2 className="ai-agent-name">{t(`agents.kinds.${a}.name`)}</h2>
            <p className="muted">{t(`agents.kinds.${a}.desc`)}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => startNew(a)}>
              {t('agents.run')}
            </button>
          </li>
        ))}
      </ul>

      <h2 className="ai-section-title">{t('agents.runs')}</h2>
      {rowError && (
        <p className="form-error" role="alert">
          {rowError}
        </p>
      )}
      {runs.length === 0 ? (
        <EmptyState
          title={t('agents.emptyTitle')}
          body={t('agents.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => startNew('enrich_companies')}>
              {t('agents.new')}
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table crm-table ai-runs-table">
            <thead>
              <tr>
                <th>{t('agents.cols.name')}</th>
                <th>{t('agents.cols.agent')}</th>
                <th>{t('agents.cols.status')}</th>
                <th className="num">{t('agents.cols.progress')}</th>
                <th className="num cell-date">{t('agents.cols.created')}</th>
                <th aria-label={tc('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-testid="ai-run-row">
                  <td>
                    {renamingId === r.id ? (
                      <input
                        className="input"
                        value={renameValue}
                        autoFocus
                        maxLength={120}
                        aria-label={t('agents.rename')}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(r.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onBlur={() => void rename(r.id)}
                      />
                    ) : (
                      <Link href={`/app/crm/agents/${r.id}`} className="cell-name">
                        {r.name}
                      </Link>
                    )}
                  </td>
                  <td>{t(`agents.kinds.${r.agent}.name`)}</td>
                  <td>
                    <span className={`badge ai-status-${r.status}`}>{t(`agents.status.${r.status}`)}</span>
                  </td>
                  <td className="num">
                    {r.processed}/{r.total}
                  </td>
                  <td className="num muted cell-date">{formatAiWhen(r.createdAt, locale)}</td>
                  <td>
                    {confirmingId === r.id ? (
                      <div className="cell-actions confirm">
                        <span className="confirm-label">{t('agents.deleteConfirm')}</span>
                        <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={() => remove(r.id)}>
                          {tc('common.delete')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingId(null)}>
                          {tc('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          title={t('agents.rename')}
                          aria-label={`${t('agents.rename')} ${r.name}`}
                          onClick={() => {
                            setRenamingId(r.id);
                            setRenameValue(r.name);
                          }}
                        >
                          <CrmIcon name="edit" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm row-delete"
                          title={tc('common.delete')}
                          aria-label={`${tc('common.delete')} ${r.name}`}
                          onClick={() => setConfirmingId(r.id)}
                        >
                          <CrmIcon name="x" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={creating}
        onClose={() => setCreating(false)}
        title={t('agents.new')}
        onSubmit={create}
        submitLabel={t('agents.start')}
        cancelLabel={tc('common.cancel')}
        busy={busy}
        error={error}
      >
        <fieldset className="ai-agent-pick">
          <legend className="label">{t('agents.cols.agent')}</legend>
          {AGENTS.map((a) => (
            <label key={a} className="ai-agent-option">
              <input type="radio" name="ai-agent" value={a} checked={agent === a} onChange={() => setAgent(a)} />
              <span>
                <strong>{t(`agents.kinds.${a}.name`)}</strong>
                <span className="muted">{t(`agents.kinds.${a}.desc`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {agent !== 'enrich_companies' && (
          <div className="ui-field">
            <label className="label" htmlFor="ai-run-list">
              {agent === 'outreach' ? t('agents.list') : t('agents.listOptional')}
            </label>
            <select id="ai-run-list" className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">{agent === 'outreach' ? t('agents.pickList') : t('agents.allMissing')}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.count})
                </option>
              ))}
            </select>
            {lists.length === 0 && agent === 'outreach' && (
              <span className="ui-help">
                {t('agents.noLists')} <Link href="/app/crm/lists">{t('agents.goLists')}</Link>
              </span>
            )}
          </div>
        )}
        {agent === 'outreach' && (
          <div className="ui-field">
            <label className="label" htmlFor="ai-run-goal">
              {t('agents.goal')}
            </label>
            <textarea
              id="ai-run-goal"
              className="textarea"
              rows={3}
              maxLength={2000}
              value={instructions}
              placeholder={t('agents.goalPlaceholder')}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        )}
        <p className="ui-help">{needsAi ? t('agents.reviewNote') : t('agents.noAiNote')}</p>
      </QuickModal>
    </>
  );
}
