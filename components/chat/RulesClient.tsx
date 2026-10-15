'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAgent, ChatAssignmentRuleRow } from '@/lib/chat-data';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

interface RulesClientProps {
  widgetId: string;
  agents: ChatAgent[];
  /** Zona en la que se evalúan las reglas de horario (la del horario de atención). */
  timeZone: string;
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

export default function RulesClient({ widgetId, agents, timeZone }: RulesClientProps) {
  const t = useTranslations('chat');
  const [rules, setRules] = useState<ChatAssignmentRuleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm());

  async function fetchRules() {
    setError(null);
    try {
      const res = await fetch(`/api/chat/widgets/${widgetId}/rules`);
      if (!res.ok) throw new Error('fetch_failed');
      const data = (await res.json()) as { rules: ChatAssignmentRuleRow[] };
      setRules(data.rules);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    fetchRules();
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
      setFormError(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('rules.deleteConfirm'))) return;
    setRules((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/chat/rules/${id}`, { method: 'DELETE' });
    await fetchRules();
  }

  async function toggleActive(rule: ChatAssignmentRuleRow) {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: r.active === 1 ? 0 : 1 } : r)));
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

  const agentLabel = (id: string | null) => {
    const a = agents.find((x) => x.id === id);
    return a ? a.name || a.email : '—';
  };

  return (
    <section className="chat-section">
      <div className="chat-section-head">
        <p className="muted chat-section-sub">{t('rules.sub')}</p>
        {rules.length > 0 && (
          <button type="button" className="btn btn-solid btn-small" onClick={startCreate}>
            {t('rules.add')}
            <span className="kbd-hint">C</span>
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {loaded && rules.length === 0 ? (
        <div className="empty-state chat-empty">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('rules.empty')}</h2>
          <p className="muted">{t('rules.emptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={startCreate}>
            {t('rules.add')}
          </button>
        </div>
      ) : (
        <ul className="chat-rules-list">
          {rules.map((rule, index) => (
            <li key={rule.id} className={`chat-rule-row${rule.active === 1 ? '' : ' is-inactive'}`}>
              <button type="button" className="chat-rule-info" onClick={() => startEdit(rule)}>
                <span className="chat-rule-position mono">{index + 1}</span>
                <span className="chat-rule-main">
                  <span className="chat-rule-name">{rule.name}</span>
                  <span className="chat-rule-match mono muted">
                    {matchTypeLabel(rule.match_type)}
                    {rule.match_value ? `: ${rule.match_value}` : ''}
                    {' → '}
                    {rule.match_type === 'round_robin' ? t('rules.roundRobin') : agentLabel(rule.assign_to)}
                  </span>
                </span>
              </button>
              <div className="chat-rule-actions">
                <label className="chat-rule-toggle mono">
                  <input
                    type="checkbox"
                    checked={rule.active === 1}
                    onChange={() => toggleActive(rule)}
                  />
                  {rule.active === 1 ? t('rules.active') : t('rules.inactive')}
                </label>
                <button
                  type="button"
                  className="chat-widget-action mono"
                  onClick={() => reorder(rule.id, 'up')}
                  disabled={index === 0}
                  aria-label={t('rules.moveUp')}
                  title={t('rules.moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="chat-widget-action mono"
                  onClick={() => reorder(rule.id, 'down')}
                  disabled={index === rules.length - 1}
                  aria-label={t('rules.moveDown')}
                  title={t('rules.moveDown')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="chat-widget-action chat-widget-action-danger mono"
                  onClick={() => remove(rule.id)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <QuickModal
        open={editingId !== null}
        onClose={cancelEdit}
        crumb={`${t('rules.title')} › ${editingId === 'new' ? t('rules.add') : t('common.edit')}`}
        onSubmit={save}
        submitLabel={editingId === 'new' ? t('quick.create') : t('common.save')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!form.name.trim()}
        busy={saving}
        error={formError}
        hint={t('quick.saveHint')}
      >
        <input
          className="qm-title"
          value={form.name}
          maxLength={120}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder={t('rules.namePlaceholder')}
          aria-label={t('widgetForm.name')}
        />
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('rules.matchType')}</span>
            <select
              value={form.matchType}
              onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value as RuleForm['matchType'] }))}
            >
              <option value="all">{t('rules.matchAll')}</option>
              <option value="keyword">{t('rules.matchKeyword')}</option>
              <option value="time">{t('rules.matchTime')}</option>
              <option value="round_robin">{t('rules.roundRobin')}</option>
            </select>
          </label>
          {form.matchType !== 'round_robin' && (
            <label className="qm-field">
              <span>{t('rules.assignTo')}</span>
              <select value={form.assignTo} onChange={(e) => setForm((f) => ({ ...f, assignTo: e.target.value }))}>
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
          <label className="qm-field">
            <span>{t('rules.keyword')}</span>
            <input
              value={form.matchValue}
              onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
              placeholder={t('rules.keywordPlaceholder')}
            />
          </label>
        )}
        {form.matchType === 'time' && (
          <label className="qm-field">
            <span>{t('rules.timeRange')}</span>
            <input
              value={form.matchValue}
              onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
              placeholder="09:00-17:00"
            />
            <small className="muted">{t('rules.timeZoneHint', { zone: timeZone })}</small>
          </label>
        )}
        <label className="qm-check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          {t('rules.active')}
        </label>
      </QuickModal>
    </section>
  );
}
