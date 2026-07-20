'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent, ChatAssignmentRuleRow } from '@/lib/chat-data';

interface RulesClientProps {
  widgetId: string;
  agents: ChatAgent[];
}

interface RuleForm {
  name: string;
  matchType: 'all' | 'keyword' | 'time' | 'round_robin';
  matchValue: string;
  assignTo: string;
  active: boolean;
}

function emptyForm(): RuleForm {
  return { name: '', matchType: 'all', matchValue: '', assignTo: '', active: true };
}

export default function RulesClient({ widgetId, agents }: RulesClientProps) {
  const t = useTranslations('chat');
  const [rules, setRules] = useState<ChatAssignmentRuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm());

  async function fetchRules() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/rules`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rules: ChatAssignmentRuleRow[] };
      setRules(data.rules);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetId]);

  function startEdit(rule: ChatAssignmentRuleRow) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      matchType: rule.match_type,
      matchValue: rule.match_value ?? '',
      assignTo: rule.assign_to ?? '',
      active: rule.active === 1,
    });
  }

  function startCreate() {
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
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        matchType: form.matchType,
        matchValue: form.matchValue.trim() || null,
        assignTo: form.matchType === 'round_robin' ? null : form.assignTo || null,
        active: form.active,
      };
      const url =
        editingId === 'new'
          ? `/api/chat/widgets/${widgetId}/rules`
          : `/api/chat/rules/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save_failed');
      await fetchRules();
      setEditingId(null);
      setForm(emptyForm());
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('common.delete'))) return;
    await fetch(`/api/chat/rules/${id}`, { method: 'DELETE' });
    await fetchRules();
  }

  async function toggleActive(rule: ChatAssignmentRuleRow) {
    await fetch(`/api/chat/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: rule.active !== 1 }),
    });
    await fetchRules();
  }

  async function reorder(id: string, direction: 'up' | 'down') {
    const index = rules.findIndex((r) => r.id === id);
    if (index < 0) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    const orderedIds = next.map((r) => r.id);
    setRules(next);
    await fetch(`/api/chat/rules/${id}/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    await fetchRules();
  }

  const matchTypeLabel = (mt: ChatAssignmentRuleRow['match_type']) => {
    switch (mt) {
      case 'all':
        return t('rules.matchAll');
      case 'keyword':
        return t('rules.matchKeyword');
      case 'time':
        return t('rules.matchTime');
      case 'round_robin':
        return t('rules.roundRobin');
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-label">{t('rules.title')}</p>
        <button type="button" className="btn btn-small" onClick={startCreate}>
          {t('rules.add')}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {editingId && (
        <div className="chat-rule-form panel">
          <label className="field">
            <span className="prop-label">{t('widgetForm.name')}</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <div className="chat-rule-form-row">
            <label className="field">
              <span className="prop-label">{t('rules.matchType')}</span>
              <select
                className="select"
                value={form.matchType}
                onChange={(e) =>
                  setForm((f) => ({ ...f, matchType: e.target.value as RuleForm['matchType'] }))
                }
              >
                <option value="all">{t('rules.matchAll')}</option>
                <option value="keyword">{t('rules.matchKeyword')}</option>
                <option value="time">{t('rules.matchTime')}</option>
                <option value="round_robin">{t('rules.roundRobin')}</option>
              </select>
            </label>

            {form.matchType !== 'round_robin' && (
              <label className="field">
                <span className="prop-label">{t('rules.assignTo')}</span>
                <select
                  className="select"
                  value={form.assignTo}
                  onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}
                >
                  <option value="">—</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {form.matchType === 'keyword' && (
            <label className="field">
              <span className="prop-label">{t('rules.keyword')}</span>
              <input
                className="input"
                value={form.matchValue}
                onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
                placeholder={t('rules.keywordPlaceholder')}
              />
            </label>
          )}

          {form.matchType === 'time' && (
            <label className="field">
              <span className="prop-label">{t('rules.timeRange')}</span>
              <input
                className="input"
                value={form.matchValue}
                onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
                placeholder="09:00-17:00"
              />
            </label>
          )}

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            <span>{t('rules.active')}</span>
          </label>

          <div className="form-actions">
            <button type="button" className="btn btn-small" onClick={cancelEdit} disabled={saving}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !loading ? (
        <div className="chat-list-empty">
          <p className="empty-zeros mono" aria-hidden>0 0 0</p>
          <p className="muted">{t('rules.empty')}</p>
        </div>
      ) : (
        <ul className="chat-rules-list">
          {rules.map((rule, index) => (
            <li key={rule.id} className="chat-rule-row">
              <div className="chat-rule-info">
                <span className="chat-rule-position mono">{index + 1}</span>
                <div className="chat-rule-main">
                  <span className="chat-rule-name">{rule.name}</span>
                  <span className="chat-rule-match mono muted">
                    {matchTypeLabel(rule.match_type)}
                    {rule.match_value ? `: ${rule.match_value}` : ''}
                  </span>
                </div>
              </div>
              <div className="chat-rule-actions">
                <span className="chat-rule-assignee mono muted">
                  {rule.match_type === 'round_robin'
                    ? t('rules.roundRobin')
                    : agents.find((a) => a.id === rule.assign_to)
                      ? agents.find((a) => a.id === rule.assign_to)!.name ||
                        agents.find((a) => a.id === rule.assign_to)!.email
                      : '—'}
                </span>
                <button
                  type="button"
                  className={`btn btn-small${rule.active === 1 ? '' : ' btn-ghost'}`}
                  onClick={() => toggleActive(rule)}
                >
                  {rule.active === 1 ? t('rules.active') : t('rules.inactive')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => reorder(rule.id, 'up')}
                  disabled={index === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => reorder(rule.id, 'down')}
                  disabled={index === rules.length - 1}
                >
                  ↓
                </button>
                <button type="button" className="btn btn-small" onClick={() => startEdit(rule)}>
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => remove(rule.id)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
