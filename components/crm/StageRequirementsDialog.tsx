'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { PRIORITIES, SOURCES } from '@/lib/crm-constants';

/** Lo que devuelve /move con 422 missing_required (lib/crm-stage-move.ts). */
export interface MissingField {
  key: string;
  type: string;
  label?: string;
  options?: string[];
  choices?: Array<{ value: string; label: string }>;
  currency?: string;
}

export interface StageRequirements {
  stage: string;
  missing: MissingField[];
}

interface MoveRequest {
  stageId: string;
  beforeId?: string | null;
  lostReason?: string;
}

interface StageRequirementsDialogProps {
  dealId: string;
  request: MoveRequest;
  requirements: StageRequirements;
  onDone: () => void;
  onCancel: () => void;
}

/** Lee el cuerpo de un 422 de /move; null si es otro error. */
export async function readRequirements(res: Response | null): Promise<StageRequirements | null> {
  if (!res || res.status !== 422) return null;
  const body = (await res.clone().json().catch(() => null)) as { error?: string; stage?: string; missing?: MissingField[] } | null;
  return body?.error === 'missing_required' && Array.isArray(body.missing)
    ? { stage: body.stage ?? '', missing: body.missing }
    : null;
}

/**
 * La etapa pide propiedades que el deal no tiene: se completan acá y el deal
 * se mueve en el mismo paso. Empresa y contactos se asocian desde el deal.
 */
export default function StageRequirementsDialog({ dealId, request, requirements, onDone, onCancel }: StageRequirementsDialogProps) {
  const t = useTranslations('crm');
  const [req, setReq] = useState(requirements);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));
  const labelOf = (f: MissingField) => f.label ?? t(`stageRules.fields.${f.key}` as 'stageRules.fields.amount');
  const assocOnly = req.missing.every((f) => f.type === 'company' || f.type === 'contacts');

  function payload(): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    const custom: Record<string, unknown> = {};
    for (const f of req.missing) {
      const v = values[f.key];
      if (v === undefined || v === '') continue;
      if (f.key.startsWith('custom:')) custom[f.key.slice(7)] = v;
      else if (f.key === 'amount') fields.amount = Number(v);
      else fields[f.key] = v;
    }
    if (Object.keys(custom).length) fields.custom = custom;
    return fields;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/deals/${dealId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, fields: payload() }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onDone();
      return;
    }
    const again = await readRequirements(res);
    if (again) {
      setReq(again);
      setError(t('stageRules.stillMissing'));
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setError(t.has(`errors.${code}`) ? t(`errors.${code}` as 'errors.generic') : t('errors.generic'));
  }

  function input(f: MissingField) {
    const id = `req-${f.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const v = values[f.key];
    const str = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    switch (f.type) {
      case 'company':
      case 'contacts':
        return (
          <p className="ui-help">
            {t(f.type === 'company' ? 'stageRules.needCompany' : 'stageRules.needContacts')}{' '}
            <Link href={`/app/crm/deals/${dealId}`}>{t('stageRules.openDeal')}</Link>
          </p>
        );
      case 'amount':
      case 'number':
      case 'currency':
        return <input id={id} className="input" type="number" min={0} step="any" value={str} onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />;
      case 'closeDate':
      case 'date':
        return <input id={id} className="input" type="date" value={str} onChange={(e) => set(f.key, e.target.value)} />;
      case 'description':
        return <textarea id={id} className="textarea" rows={3} maxLength={5000} value={str} onChange={(e) => set(f.key, e.target.value)} />;
      case 'boolean':
        return (
          <select id={id} className="select" value={v === true ? '1' : v === false ? '0' : ''} onChange={(e) => set(f.key, e.target.value === '' ? '' : e.target.value === '1')}>
            <option value="">—</option>
            <option value="1">{t('common.yes')}</option>
            <option value="0">{t('common.no')}</option>
          </select>
        );
      case 'priority':
      case 'source': {
        const list = f.type === 'priority' ? PRIORITIES : SOURCES;
        return (
          <select id={id} className="select" value={str} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">—</option>
            {list.map((o) => (
              <option key={o} value={o}>
                {t(`enums.${f.type}.${o}` as 'enums.priority.low')}
              </option>
            ))}
          </select>
        );
      }
      case 'ownerId':
      case 'user':
        return (
          <select id={id} className="select" value={str} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">—</option>
            {(f.choices ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case 'select':
        return (
          <select id={id} className="select" value={str} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">—</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'multiselect': {
        const picked = Array.isArray(v) ? (v as string[]) : [];
        return (
          <span className="stage-req-multi">
            {(f.options ?? []).map((o) => (
              <label key={o} className="ui-check">
                <input
                  type="checkbox"
                  checked={picked.includes(o)}
                  onChange={(e) => set(f.key, e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))}
                />{' '}
                {o}
              </label>
            ))}
          </span>
        );
      }
      default:
        return <input id={id} className="input" value={str} maxLength={2000} onChange={(e) => set(f.key, e.target.value)} />;
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('stageRules.dialogTitle', { stage: req.stage })}>
      <form className="modal-card" onSubmit={submit}>
        <h2 className="modal-title">{t('stageRules.dialogTitle', { stage: req.stage })}</h2>
        <p className="muted">{t('stageRules.dialogSub')}</p>
        {req.missing.map((f) => (
          <div className="field" key={f.key}>
            <label className="prop-label" htmlFor={`req-${f.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>
              {labelOf(f)}
              {f.currency ? ` (${f.currency})` : ''}
            </label>
            {input(f)}
          </div>
        ))}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          {!assocOnly && (
            <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
              {t('stageRules.saveAndMove')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
