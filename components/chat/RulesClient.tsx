'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent, ChatAssignmentRuleRow } from '@/lib/chat-data';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import ChatIcon from './icons';

interface RulesClientProps {
  widgetId: string;
  agents: ChatAgent[];
  /** Equipos de Chat del workspace (lib/chat-collab.ts). */
  teams?: Array<{ id: string; name: string }>;
  /** Zona en la que se evalúan las reglas de horario (la del horario de atención). */
  timeZone: string;
}

interface RuleForm {
  name: string;
  matchType: 'all' | 'keyword' | 'time' | 'round_robin';
  matchValue: string;
  assignTo: string;
  teamId: string;
  teamRoundRobin: boolean;
  requiredSkill: string;
  active: boolean;
}

function emptyForm(): RuleForm {
  return { name: '', matchType: 'all', matchValue: '', assignTo: '', teamId: '', teamRoundRobin: false, requiredSkill: '', active: true };
}

/**
 * Reglas de asignación en orden: la primera que coincide asigna. Tabla densa
 * con el orden visible, un switch por regla y subir/bajar con teclado.
 */
export default function RulesClient({ widgetId, agents, teams = [], timeZone }: RulesClientProps) {
  const t = useTranslations('chat');
  const [rules, setRules] = useState<ChatAssignmentRuleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm());

  async function fetchRules() {
    setError(false);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/rules`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rules: ChatAssignmentRuleRow[] };
      setRules(data.rules);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  useKeyShortcut('c', () => startCreate(), editingId === null);

  function startEdit(rule: ChatAssignmentRuleRow) {
    setFormError(null);
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      matchType: rule.match_type,
      matchValue: rule.match_value ?? '',
      assignTo: rule.assign_to ?? '',
      teamId: rule.assign_team_id ?? '',
      teamRoundRobin: rule.team_round_robin === 1,
      requiredSkill: rule.required_skill ?? '',
      active: rule.active === 1,
    });
  }

  function startCreate() {
    setFormError(null);
    setEditingId('new');
    setForm(emptyForm());
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        matchType: form.matchType,
        matchValue: form.matchValue.trim() || null,
        assignTo: form.matchType === 'round_robin' || (form.teamId && form.teamRoundRobin) ? null : form.assignTo || null,
        assignTeamId: form.teamId || null,
        teamRoundRobin: !!form.teamId && form.teamRoundRobin,
        requiredSkill: form.requiredSkill.trim() || null,
        active: form.active,
      };
      const isNew = editingId === 'new';
      const res = await fetch(isNew ? `/api/chat/widgets/${widgetId}/rules` : `/api/chat/rules/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(data.error === 'invalid_team' ? t('teams.invalid') : t('errors.generic'));
        return;
      }
      await fetchRules();
      setEditingId(null);
      setForm(emptyForm());
    } catch {
      setFormError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: ChatAssignmentRuleRow) {
    if (!window.confirm(t('rules.deleteConfirm'))) return;
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    await fetch(`/api/chat/rules/${rule.id}`, { method: 'DELETE' }).catch(() => null);
    await fetchRules();
  }

  async function toggleActive(rule: ChatAssignmentRuleRow) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: r.active === 1 ? 0 : 1 } : r)));
    await fetch(`/api/chat/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: rule.active !== 1 }),
    }).catch(() => null);
    await fetchRules();
  }

  async function reorder(id: string, direction: 'up' | 'down') {
    const index = rules.findIndex((r) => r.id === id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    setRules(next);
    await fetch(`/api/chat/rules/${id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: next.map((r) => r.id) }),
    }).catch(() => null);
    await fetchRules();
  }

  const matchTypeLabel = (mt: ChatAssignmentRuleRow['match_type']) =>
    mt === 'all'
      ? t('rules.matchAll')
      : mt === 'keyword'
        ? t('rules.matchKeyword')
        : mt === 'time'
          ? t('rules.matchTime')
          : t('rules.roundRobin');

  const agentLabel = (id: string | null) => {
    const a = agents.find((x) => x.id === id);
    return a ? a.name || a.email : t('conversation.unassigned');
  };

  const createButton = (
    <button type="button" className="btn btn-primary" onClick={startCreate}>
      {t('rules.add')}
    </button>
  );

  return (
    <section className="chat-pane" aria-labelledby="chat-rules-title">
      <div className="chat-pane-head">
        <div>
          <h2 id="chat-rules-title" className="ui-section-title">
            {t('rules.title')}
          </h2>
          <p className="ui-section-desc">{t('rules.sub')}</p>
        </div>
        {rules.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" onClick={startCreate} aria-keyshortcuts="c">
            {t('rules.add')}
            <kbd className="kbd">C</kbd>
          </button>
        )}
      </div>

      {error ? (
        <div className="chat-load-error" role="alert">
          <p>{t('errors.loadFailed')}</p>
          <button type="button" className="btn btn-sm" onClick={() => fetchRules()}>
            {t('common.retry')}
          </button>
        </div>
      ) : !loaded ? (
        <div className="ui-loading-stack" aria-label={t('common.loading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState title={t('rules.empty')} body={t('rules.emptySub')} action={createButton} product="chat" />
      ) : (
        <div className="table-wrap chat-stack">
          <table className="table chat-rules-table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  <span className="sr-only">{t('rules.order')}</span>
                </th>
                <th scope="col">{t('rules.name')}</th>
                <th scope="col">{t('rules.condition')}</th>
                <th scope="col">{t('rules.assignTo')}</th>
                <th scope="col">{t('rules.state')}</th>
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.id} data-inactive={rule.active === 1 ? undefined : true}>
                  <td className="num data chat-rule-pos chat-stack-hide">{index + 1}</td>
                  <td>
                    <button type="button" className="chat-row-button" onClick={() => startEdit(rule)}>
                      {rule.name}
                    </button>
                  </td>
                  <td data-label={t('rules.condition')}>
                    <span>
                      {matchTypeLabel(rule.match_type)}
                      {rule.match_value && <span className="chat-rule-value data">{rule.match_value}</span>}
                    </span>
                  </td>
                  <td data-label={t('rules.assignTo')}>
                    {(() => {
                      const team = teams.find((x) => x.id === rule.assign_team_id);
                      const who =
                        rule.match_type === 'round_robin' || (team && rule.team_round_robin === 1)
                          ? team
                            ? t('teams.roundRobinIn', { team: team.name })
                            : t('rules.roundRobinTeam')
                          : team && !rule.assign_to
                            ? t('teams.inboxOf', { team: team.name })
                            : agentLabel(rule.assign_to);
                      return team && rule.assign_to && rule.match_type !== 'round_robin' && rule.team_round_robin !== 1 ? `${team.name} · ${who}` : who;
                    })()}
                  </td>
                  <td data-label={t('rules.state')}>
                    <label className="ui-switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={rule.active === 1}
                        onChange={() => toggleActive(rule)}
                        aria-label={t('rules.toggle', { name: rule.name })}
                      />
                      <span aria-hidden="true">{rule.active === 1 ? t('rules.active') : t('rules.inactive')}</span>
                    </label>
                  </td>
                  <td className="chat-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => reorder(rule.id, 'up')}
                      disabled={index === 0}
                      aria-label={t('rules.moveUpNamed', { name: rule.name })}
                      title={t('rules.moveUp')}
                    >
                      <ChatIcon name="up" size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => reorder(rule.id, 'down')}
                      disabled={index === rules.length - 1}
                      aria-label={t('rules.moveDownNamed', { name: rule.name })}
                      title={t('rules.moveDown')}
                    >
                      <ChatIcon name="down" size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => remove(rule)}
                      aria-label={t('rules.deleteNamed', { name: rule.name })}
                      title={t('common.delete')}
                    >
                      <ChatIcon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={editingId !== null}
        onClose={cancelEdit}
        title={editingId === 'new' ? t('rules.newTitle') : t('rules.editTitle')}
        onSubmit={save}
        submitLabel={editingId === 'new' ? t('rules.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!form.name.trim()}
        busy={saving}
        error={formError}
        hint={t('quick.saveHint')}
      >
        <div className="ui-fields">
          <div className="ui-field">
            <label className="label" htmlFor="rule-name">
              {t('rules.name')}
            </label>
            <input
              id="rule-name"
              className="input"
              data-autofocus
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('rules.namePlaceholder')}
            />
          </div>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="rule-type">
                {t('rules.matchType')}
              </label>
              <select
                id="rule-type"
                className="select"
                value={form.matchType}
                onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as RuleForm['matchType'] }))}
              >
                <option value="all">{t('rules.matchAll')}</option>
                <option value="keyword">{t('rules.matchKeyword')}</option>
                <option value="time">{t('rules.matchTime')}</option>
                <option value="round_robin">{t('rules.roundRobin')}</option>
              </select>
            </div>
            {form.matchType !== 'round_robin' && !(form.teamId && form.teamRoundRobin) && (
              <div className="ui-field">
                <label className="label" htmlFor="rule-assign">
                  {t('rules.assignTo')}
                </label>
                <select
                  id="rule-assign"
                  className="select"
                  value={form.assignTo}
                  onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}
                >
                  <option value="">{t('conversation.unassigned')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.email}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {teams.length > 0 && (
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor="rule-team">
                  {t('teams.assignTeam')}
                </label>
                <select
                  id="rule-team"
                  className="select"
                  value={form.teamId}
                  onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}
                >
                  <option value="">{t('teams.noTeam')}</option>
                  {teams.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              {form.teamId && form.matchType !== 'round_robin' && (
                <label className="ui-switch chat-rule-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={form.teamRoundRobin}
                    onChange={(e) => setForm((f) => ({ ...f, teamRoundRobin: e.target.checked }))}
                  />
                  {t('teams.spread')}
                </label>
              )}
            </div>
          )}
          <div className="ui-field">
            <label className="label" htmlFor="rule-skill">
              {t('routing.requiredSkill')}
            </label>
            <input
              id="rule-skill"
              className="input"
              maxLength={40}
              value={form.requiredSkill}
              placeholder={t('routing.skillPlaceholder')}
              onChange={(e) => setForm((f) => ({ ...f, requiredSkill: e.target.value }))}
            />
            <p className="ui-help">{t('routing.requiredSkillHint')}</p>
          </div>
          {form.matchType === 'keyword' && (
            <div className="ui-field">
              <label className="label" htmlFor="rule-keyword">
                {t('rules.keyword')}
              </label>
              <input
                id="rule-keyword"
                className="input"
                value={form.matchValue}
                onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
                placeholder={t('rules.keywordPlaceholder')}
              />
            </div>
          )}
          {form.matchType === 'time' && (
            <div className="ui-field">
              <label className="label" htmlFor="rule-time">
                {t('rules.timeRange')}
              </label>
              <input
                id="rule-time"
                className="input data"
                value={form.matchValue}
                onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
                placeholder="09:00-17:00"
                aria-describedby="rule-time-help"
              />
              <p id="rule-time-help" className="ui-help">
                {t('rules.timeZoneHint', { zone: timeZone })}
              </p>
            </div>
          )}
          <label className="ui-switch">
            <input
              type="checkbox"
              role="switch"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            {t('rules.active')}
          </label>
        </div>
      </QuickModal>
    </section>
  );
}
