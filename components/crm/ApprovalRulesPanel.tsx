'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface Rule {
  id: string;
  pipelineId: string;
  stageId: string;
  minAmount: number | null;
  minDiscount: number | null;
  approverIds: string[];
  enabled: boolean;
}

interface ApprovalRulesPanelProps {
  rules: Rule[];
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  people: Array<{ id: string; label: string }>;
  baseCurrency: string;
  locale: string;
  canEdit: boolean;
}

const ERRORS = new Set(['invalid_stage', 'invalid_approver']);

/**
 * Reglas de aprobación por etapa: quién aprueba entrar a esa etapa, siempre o
 * desde cierto monto (en moneda base) o descuento.
 */
export default function ApprovalRulesPanel({ rules: initial, pipelines, people, baseCurrency, locale, canEdit }: ApprovalRulesPanelProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rules, setRules] = useState(initial);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const [minAmount, setMinAmount] = useState('');
  const [minDiscount, setMinDiscount] = useState('');
  const [approvers, setApprovers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageName = (r: Rule) => {
    const p = pipelines.find((x) => x.id === r.pipelineId);
    const s = p?.stages.find((x) => x.id === r.stageId);
    return `${p?.name ?? ''} › ${s?.name ?? ''}`;
  };
  const personName = (id: string) => people.find((p) => p.id === id)?.label ?? '';
  const money = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency || 'USD', maximumFractionDigits: 0 }).format(v);

  function describe(r: Rule): string {
    const parts: string[] = [];
    if (r.minAmount !== null) parts.push(t('approvals.rules.amountAtLeast', { amount: money(r.minAmount) }));
    if (r.minDiscount !== null) parts.push(t('approvals.rules.discountAtLeast', { pct: r.minDiscount }));
    return parts.length ? parts.join(' · ') : t('approvals.rules.always');
  }

  async function add() {
    if (busy) return;
    setError(null);
    if (!stageId || !approvers.length) {
      setError(t('approvals.rules.incomplete'));
      return;
    }
    setBusy(true);
    const res = await fetch('/api/crm/approval-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pipelineId,
        stageId,
        minAmount: minAmount.trim() === '' ? null : Number(minAmount),
        minDiscount: minDiscount.trim() === '' ? null : Number(minDiscount),
        approverIds: approvers,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(t(body?.error && ERRORS.has(body.error) ? `approvals.rules.errors.${body.error}` : 'approvals.rules.incomplete'));
      return;
    }
    const rule = (await res.json()) as Rule;
    setRules((prev) => [...prev, rule]);
    setMinAmount('');
    setMinDiscount('');
    setApprovers([]);
    router.refresh();
  }

  async function toggle(r: Rule) {
    const res = await fetch(`/api/crm/approval-rules/${r.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...r, enabled: !r.enabled }),
    }).catch(() => null);
    if (res?.ok) {
      const rule = (await res.json()) as Rule;
      setRules((prev) => prev.map((x) => (x.id === r.id ? rule : x)));
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/crm/approval-rules/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setRules((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="appr-rules" id="approvals">
      {rules.length === 0 ? (
        <p className="muted">{t('approvals.rules.empty')}</p>
      ) : (
        <ul className="score-rules">
          {rules.map((r) => (
            <li key={r.id} className={`score-rule${r.enabled ? '' : ' off'}`} data-testid="approval-rule">
              <span className="score-desc">
                <strong>{stageName(r)}</strong> · {describe(r)} · {t('approvals.rules.by', { names: r.approverIds.map(personName).filter(Boolean).join(', ') })}
              </span>
              {canEdit && (
                <span className="score-actions">
                  <button type="button" className="icon-btn" onClick={() => void toggle(r)}>
                    {r.enabled ? t('scoring.disable') : t('scoring.enable')}
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => void remove(r.id)} aria-label={t('common.delete')}>
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
              value={pipelineId}
              aria-label={t('approvals.rules.pipeline')}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId(pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id ?? '');
              }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="filter-select" value={stageId} aria-label={t('approvals.rules.stage')} onChange={(e) => setStageId(e.target.value)} data-testid="approval-rule-stage">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="score-num">
              <span className="muted">{t('approvals.rules.minAmount', { currency: baseCurrency })}</span>
              <input className="input mono" type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </label>
            <label className="score-num">
              <span className="muted">{t('approvals.rules.minDiscount')}</span>
              <input className="input mono" type="number" min={0} max={100} value={minDiscount} onChange={(e) => setMinDiscount(e.target.value)} />
            </label>
          </div>
          <fieldset className="appr-approvers">
            <legend className="prop-label">{t('approvals.rules.approvers')}</legend>
            {people.map((p) => (
              <label key={p.id} className="ui-check">
                <input
                  type="checkbox"
                  checked={approvers.includes(p.id)}
                  onChange={(e) => setApprovers((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                />{' '}
                {p.label}
              </label>
            ))}
          </fieldset>
          <p className="ui-help">{t('approvals.rules.help')}</p>
          <div className="score-add-row">
            <button type="button" className="btn btn-solid btn-small" onClick={() => void add()} disabled={busy} data-testid="approval-rule-add">
              {t('approvals.rules.add')}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
      ) : (
        <p className="muted">{t('common.adminOnly')}</p>
      )}
    </div>
  );
}
