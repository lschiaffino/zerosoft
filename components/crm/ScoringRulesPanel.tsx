'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  SCORE_ACTIVITIES,
  SCORE_OPS,
  SCORE_PROPERTY_FIELDS,
  type ActivityRuleConfig,
  type PropertyRuleConfig,
  type ScoreRule,
} from '@/lib/crm-scoring-schema';

interface Props {
  initialRules: ScoreRule[];
  customFields: Array<{ name: string; label: string }>;
  canEdit: boolean;
}

type Draft = {
  kind: 'property' | 'activity';
  name: string;
  points: string;
  field: string;
  op: string;
  value: string;
  activity: string;
  days: string;
  min: string;
};

const EMPTY: Draft = {
  kind: 'property',
  name: '',
  points: '10',
  field: 'lifecycleStage',
  op: 'equals',
  value: '',
  activity: 'email_opened',
  days: '30',
  min: '1',
};

/** Reglas de lead scoring: propiedad o actividad, puntos +/−; recalcular todo. */
export default function ScoringRulesPanel({ initialRules, customFields, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rules, setRules] = useState<ScoreRule[]>(initialRules);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function describe(r: ScoreRule): string {
    if (r.kind === 'property') {
      const c = r.config as PropertyRuleConfig;
      const field = c.field.startsWith('custom.')
        ? (customFields.find((f) => `custom.${f.name}` === c.field)?.label ?? c.field)
        : t(`scoring.fields.${c.field}`);
      const needsValue = c.op !== 'is_set' && c.op !== 'is_not_set';
      return `${field} ${t(`scoring.ops.${c.op}`)}${needsValue ? ` "${c.value}"` : ''}`;
    }
    const c = r.config as ActivityRuleConfig;
    return t('scoring.activityRule', { activity: t(`scoring.activities.${c.activity}`), min: c.min, days: c.days });
  }

  function body(d: Draft, enabled = true) {
    const points = Math.round(Number(d.points));
    if (d.kind === 'property') {
      return { kind: 'property', name: d.name.trim(), points, enabled, config: { field: d.field, op: d.op, value: d.value } };
    }
    return {
      kind: 'activity',
      name: d.name.trim(),
      points,
      enabled,
      config: { activity: d.activity, days: Math.round(Number(d.days)), min: Math.max(1, Math.round(Number(d.min))) },
    };
  }

  async function add() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/scoring/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body(draft)),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const rule = (await res.json()) as ScoreRule;
      setRules((prev) => [...prev, rule]);
      setDraft({ ...EMPTY, kind: draft.kind });
      router.refresh();
      return;
    }
    setError(t('scoring.invalid'));
  }

  async function toggle(rule: ScoreRule) {
    const res = await fetch(`/api/crm/scoring/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: rule.kind, name: rule.name, points: rule.points, enabled: !rule.enabled, config: rule.config }),
    }).catch(() => null);
    if (res?.ok) {
      const updated = (await res.json()) as ScoreRule;
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
      router.refresh();
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/crm/scoring/rules/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      setRules((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    }
  }

  async function recalc() {
    setBusy(true);
    setNote(null);
    const res = await fetch('/api/crm/scoring/recalculate', { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const data = (await res.json()) as { processed: number; changed: number };
      setNote(t('scoring.recalculated', { processed: data.processed, changed: data.changed }));
      router.refresh();
    }
  }

  const needsValue = draft.op !== 'is_set' && draft.op !== 'is_not_set';

  return (
    <div className="score-panel">
      {rules.length === 0 ? (
        <p className="muted">{t('scoring.empty')}</p>
      ) : (
        <ul className="score-rules">
          {rules.map((r) => (
            <li key={r.id} className={`score-rule${r.enabled ? '' : ' off'}`} data-testid="score-rule">
              <span className={`mono score-points ${r.points >= 0 ? 'pos' : 'neg'}`}>
                {r.points > 0 ? `+${r.points}` : r.points}
              </span>
              <span className="score-desc">
                {r.name && <strong>{r.name} · </strong>}
                {describe(r)}
              </span>
              {canEdit && (
                <span className="score-actions">
                  <button type="button" className="icon-btn" onClick={() => toggle(r)}>
                    {r.enabled ? t('scoring.disable') : t('scoring.enable')}
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => remove(r.id)} aria-label={t('common.delete')}>
                    ✕
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="score-add">
          <div className="score-add-row">
            <select
              className="filter-select"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}
              aria-label={t('scoring.kind')}
            >
              <option value="property">{t('scoring.kindProperty')}</option>
              <option value="activity">{t('scoring.kindActivity')}</option>
            </select>
            {draft.kind === 'property' ? (
              <>
                <select
                  className="filter-select"
                  value={draft.field}
                  onChange={(e) => setDraft({ ...draft, field: e.target.value })}
                  aria-label={t('scoring.field')}
                >
                  {SCORE_PROPERTY_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`scoring.fields.${f}`)}
                    </option>
                  ))}
                  {customFields.map((f) => (
                    <option key={f.name} value={`custom.${f.name}`}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  className="filter-select"
                  value={draft.op}
                  onChange={(e) => setDraft({ ...draft, op: e.target.value })}
                  aria-label={t('scoring.op')}
                >
                  {SCORE_OPS.map((op) => (
                    <option key={op} value={op}>
                      {t(`scoring.ops.${op}`)}
                    </option>
                  ))}
                </select>
                {needsValue && (
                  <input
                    className="input"
                    value={draft.value}
                    onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                    placeholder={t('scoring.value')}
                    aria-label={t('scoring.value')}
                  />
                )}
              </>
            ) : (
              <>
                <select
                  className="filter-select"
                  value={draft.activity}
                  onChange={(e) => setDraft({ ...draft, activity: e.target.value })}
                  aria-label={t('scoring.activity')}
                >
                  {SCORE_ACTIVITIES.map((a) => (
                    <option key={a} value={a}>
                      {t(`scoring.activities.${a}`)}
                    </option>
                  ))}
                </select>
                <label className="score-num">
                  <span className="muted">{t('scoring.atLeast')}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    value={draft.min}
                    onChange={(e) => setDraft({ ...draft, min: e.target.value })}
                  />
                </label>
                <label className="score-num">
                  <span className="muted">{t('scoring.inLastDays')}</span>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={365}
                    value={draft.days}
                    onChange={(e) => setDraft({ ...draft, days: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          <div className="score-add-row">
            <label className="score-num">
              <span className="muted">{t('scoring.points')}</span>
              <input
                className="input mono"
                type="number"
                value={draft.points}
                onChange={(e) => setDraft({ ...draft, points: e.target.value })}
                aria-label={t('scoring.points')}
              />
            </label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t('scoring.namePlaceholder')}
              aria-label={t('scoring.name')}
            />
            <button type="button" className="btn btn-solid btn-small" onClick={add} disabled={busy || !draft.points} data-testid="score-add">
              {t('scoring.add')}
            </button>
            <button type="button" className="btn btn-small" onClick={recalc} disabled={busy}>
              {t('scoring.recalculate')}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          {note && <p className="mono muted">{note}</p>}
        </div>
      ) : (
        <p className="muted">{t('common.adminOnly')}</p>
      )}
    </div>
  );
}
