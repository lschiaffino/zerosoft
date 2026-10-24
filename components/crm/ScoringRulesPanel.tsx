'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  SCORE_ACTIVITIES,
  SCORE_OPS,
  SCORE_PROPERTY_FIELDS,
  MAX_SCORES,
  type ActivityRuleConfig,
  type PropertyRuleConfig,
  type ScoreDef,
  type ScoreRule,
} from '@/lib/crm-scoring-schema';

interface Props {
  initialRules: ScoreRule[];
  initialScores: ScoreDef[];
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

/**
 * Lead scoring: varios scores (como HubSpot), cada uno con umbrales,
 * decaimiento y sus reglas de propiedad o actividad (puntos +/−).
 */
export default function ScoringRulesPanel({ initialRules, initialScores, customFields, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [scores, setScores] = useState<ScoreDef[]>(initialScores);
  const [selectedId, setSelectedId] = useState<string>(initialScores.find((x) => x.isPrimary)?.id ?? initialScores[0]?.id ?? '');
  const [allRules, setRules] = useState<ScoreRule[]>(initialRules);
  const selected = scores.find((x) => x.id === selectedId) ?? scores[0];
  const rules = allRules.filter((r) => !selected || (r.scoreId ?? '') === selected.id);
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
    const scoreId = selected?.id;
    if (d.kind === 'property') {
      return { kind: 'property', scoreId, name: d.name.trim(), points, enabled, config: { field: d.field, op: d.op, value: d.value } };
    }
    return {
      kind: 'activity',
      scoreId,
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
      <ScoreTabs
        scores={scores}
        selectedId={selected?.id ?? ''}
        canEdit={canEdit}
        onSelect={setSelectedId}
        onCreated={(sc) => {
          setScores((prev) => [...prev, sc]);
          setSelectedId(sc.id);
        }}
      />
      {selected && (
        <ScoreSettings
          key={selected.id}
          score={selected}
          canEdit={canEdit}
          onSaved={(sc) => {
            setScores((prev) => prev.map((x) => (x.id === sc.id ? sc : x)));
            router.refresh();
          }}
          onDeleted={() => {
            setScores((prev) => prev.filter((x) => x.id !== selected.id));
            setRules((prev) => prev.filter((r) => r.scoreId !== selected.id));
            setSelectedId(scores.find((x) => x.isPrimary)?.id ?? '');
            router.refresh();
          }}
        />
      )}
      <h3 className="score-rules-title">{t('scoring.rulesOf', { name: selected?.name ?? '' })}</h3>
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
            {/* Sin reglas no hay nada que recalcular. */}
            {rules.length > 0 && (
              <button type="button" className="btn btn-small" onClick={recalc} disabled={busy}>
                {t('scoring.recalculate')}
              </button>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          {note && <p className="ui-help">{note}</p>}
        </div>
      ) : (
        <p className="muted">{t('common.adminOnly')}</p>
      )}
    </div>
  );
}

/** Pestañas de scores + crear uno nuevo. Flechas izquierda/derecha cambian de score. */
function ScoreTabs({
  scores,
  selectedId,
  canEdit,
  onSelect,
  onCreated,
}: {
  scores: ScoreDef[];
  selectedId: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreated: (score: ScoreDef) => void;
}) {
  const t = useTranslations('crm');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    const res = await fetch('/api/crm/scoring/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('scoring.scoreLimit', { max: MAX_SCORES }));
      return;
    }
    onCreated((await res.json()) as ScoreDef);
    setName('');
    setAdding(false);
  }

  return (
    <div className="score-tabs-row">
      <div className="ui-tabs score-tabs" role="tablist" aria-label={t('scoring.scores')}>
        {scores.map((sc, i) => (
          <button
            key={sc.id}
            type="button"
            role="tab"
            aria-selected={sc.id === selectedId}
            tabIndex={sc.id === selectedId ? 0 : -1}
            className="ui-tab"
            onClick={() => onSelect(sc.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + scores.length) % scores.length;
              onSelect(scores[j].id);
              e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[j]?.focus();
            }}
            data-testid="score-tab"
          >
            {sc.name}
          </button>
        ))}
      </div>
      {canEdit &&
        (adding ? (
          <span className="score-new">
            <input
              className="input"
              value={name}
              autoFocus
              maxLength={80}
              placeholder={t('scoring.newScorePlaceholder')}
              aria-label={t('scoring.newScore')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                } else if (e.key === 'Escape') {
                  setAdding(false);
                }
              }}
            />
            <button type="button" className="btn btn-solid btn-small" onClick={() => void create()} disabled={!name.trim()} data-testid="score-create">
              {t('scoring.createScore')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-small" onClick={() => setAdding(true)} disabled={scores.length >= MAX_SCORES} data-testid="score-new">
            {t('scoring.newScore')}
          </button>
        ))}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Nombre, umbrales (tramos) y decaimiento de un score. */
function ScoreSettings({
  score,
  canEdit,
  onSaved,
  onDeleted,
}: {
  score: ScoreDef;
  canEdit: boolean;
  onSaved: (score: ScoreDef) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('crm');
  const [name, setName] = useState(score.name);
  const [tiers, setTiers] = useState(score.thresholds.map((x) => ({ label: x.label, min: String(x.min) })));
  const [decayOn, setDecayOn] = useState(!!score.decayDays && score.decayPct > 0);
  const [decayDays, setDecayDays] = useState(String(score.decayDays ?? 90));
  const [decayPct, setDecayPct] = useState(String(score.decayPct || 50));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await fetch(`/api/crm/scoring/scores/${score.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || score.name,
        thresholds: tiers
          .filter((x) => x.label.trim() && x.min.trim() !== '' && !Number.isNaN(Number(x.min)))
          .map((x) => ({ label: x.label.trim(), min: Math.round(Number(x.min)) })),
        decayDays: decayOn ? Math.max(1, Math.round(Number(decayDays) || 90)) : null,
        decayPct: decayOn ? Math.min(100, Math.max(1, Math.round(Number(decayPct) || 50))) : 0,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('scoring.invalid'));
      return;
    }
    const saved = (await res.json()) as ScoreDef;
    setTiers(saved.thresholds.map((x) => ({ label: x.label, min: String(x.min) })));
    setNote(t('scoring.scoreSaved'));
    onSaved(saved);
  }

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/crm/scoring/scores/${score.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDeleted();
    else setError(t('errors.generic'));
  }

  return (
    <div className="score-settings" data-testid="score-settings">
      <label className="field score-name">
        <span className="prop-label">{t('scoring.scoreName')}</span>
        <input className="input" value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} data-testid="score-name" />
      </label>
      <fieldset className="score-tiers">
        <legend className="prop-label">{t('scoring.tiers')}</legend>
        <p className="ui-help">{t('scoring.tiersHelp')}</p>
        {tiers.map((tier, i) => (
          <div key={i} className="score-add-row" data-testid="score-tier-row">
            <input
              className="input"
              value={tier.label}
              maxLength={40}
              disabled={!canEdit}
              placeholder={t('scoring.tierLabel')}
              aria-label={t('scoring.tierLabel')}
              onChange={(e) => setTiers((prev) => prev.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
            />
            <label className="score-num">
              <span className="muted">{t('scoring.tierFrom')}</span>
              <input
                className="input mono"
                type="number"
                value={tier.min}
                disabled={!canEdit}
                onChange={(e) => setTiers((prev) => prev.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)))}
              />
            </label>
            {canEdit && (
              <button type="button" className="icon-btn danger" onClick={() => setTiers((prev) => prev.filter((_, k) => k !== i))} aria-label={t('common.delete')}>
                ✕
              </button>
            )}
          </div>
        ))}
        {canEdit && tiers.length < 6 && (
          <button type="button" className="btn btn-small" onClick={() => setTiers((prev) => [...prev, { label: '', min: '' }])} data-testid="score-add-tier">
            {t('scoring.addTier')}
          </button>
        )}
      </fieldset>
      <fieldset className="score-decay">
        <legend className="prop-label">{t('scoring.decay')}</legend>
        <label className="ui-check">
          <input type="checkbox" checked={decayOn} disabled={!canEdit} onChange={(e) => setDecayOn(e.target.checked)} data-testid="score-decay-on" />{' '}
          {t('scoring.decayOn')}
        </label>
        {decayOn && (
          <div className="score-add-row">
            <label className="score-num">
              <span className="muted">{t('scoring.decayAfter')}</span>
              <input className="input mono" type="number" min={1} max={730} value={decayDays} disabled={!canEdit} onChange={(e) => setDecayDays(e.target.value)} />
            </label>
            <label className="score-num">
              <span className="muted">{t('scoring.decayBy')}</span>
              <input className="input mono" type="number" min={1} max={100} value={decayPct} disabled={!canEdit} onChange={(e) => setDecayPct(e.target.value)} />
            </label>
          </div>
        )}
        <p className="ui-help">{t('scoring.decayHelp')}</p>
      </fieldset>
      {canEdit && (
        <div className="score-add-row">
          <button type="button" className="btn btn-solid btn-small" onClick={() => void save()} disabled={busy} data-testid="score-save">
            {t('scoring.saveScore')}
          </button>
          {!score.isPrimary &&
            (confirm ? (
              <>
                <span className="muted">{t('scoring.deleteConfirm')}</span>
                <button type="button" className="btn btn-small" onClick={() => void remove()} disabled={busy} data-testid="score-delete-confirm">
                  {t('scoring.deleteScore')}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm(false)}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirm(true)} data-testid="score-delete">
                {t('scoring.deleteScore')}
              </button>
            ))}
          {note && (
            <span className="muted" role="status">
              {note}
            </span>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
