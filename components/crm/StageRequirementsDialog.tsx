'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { PRIORITIES, SOURCES } from '@/lib/crm-constants';
import ApprovalDialog, { readApproval, type ApprovalInfo } from './ApprovalDialog';

export { todayIso, wonRequirements } from '@/lib/crm-won-dialog';

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
  /** Textos propios (el diálogo de ganado usa el mismo formulario). */
  title?: string;
  sub?: string;
  submitLabel?: string;
  /** Valores precargados (p. ej. la fecha de cierre de hoy al ganar). */
  initialValues?: Record<string, unknown>;
}

/**
 * Pregunta al server qué pediría la etapa sin mover el deal (dryRun). Así la
 * UI arma un solo diálogo en vez de chocar con un 422. null si falló.
 */
export async function checkStageMove(
  dealId: string,
  stageId: string,
): Promise<(StageRequirements & { closeDate: string | null; approval: ApprovalInfo | null }) | null> {
  const res = await fetch(`/api/crm/deals/${dealId}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stageId, dryRun: true }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    stage?: string;
    missing?: MissingField[];
    closeDate?: string | null;
    approval?: ApprovalInfo | null;
  } | null;
  if (!body || !Array.isArray(body.missing)) return null;
  return { stage: body.stage ?? '', missing: body.missing, closeDate: body.closeDate ?? null, approval: body.approval ?? null };
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
export default function StageRequirementsDialog({
  dealId,
  request,
  requirements,
  onDone,
  onCancel,
  title,
  sub,
  submitLabel,
  initialValues,
}: StageRequirementsDialogProps) {
  const t = useTranslations('crm');
  const [req, setReq] = useState(requirements);
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** La etapa pide aprobación: el diálogo de propiedades deja lugar al de aprobación. */
  const [approval, setApproval] = useState<ApprovalInfo | null>(null);

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
    const needsApproval = await readApproval(res);
    if (needsApproval) {
      setApproval(needsApproval);
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

  const heading = title ?? t('stageRules.dialogTitle', { stage: req.stage });
  if (approval) return <ApprovalDialog dealId={dealId} info={approval} onClose={onCancel} />;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <form className="modal-card" onSubmit={submit}>
        <h2 className="modal-title">{heading}</h2>
        <p className="muted">{sub ?? t('stageRules.dialogSub')}</p>
        {req.missing.map((f, i) => (
          <div className="field" key={f.key}>
            <label className="prop-label" htmlFor={`req-${f.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`}>
              {labelOf(f)}
              {f.currency ? ` (${f.currency})` : ''}
            </label>
            {i === 0 ? <AutoFocus>{input(f)}</AutoFocus> : input(f)}
          </div>
        ))}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          {!assocOnly && (
            <button type="submit" className="btn btn-solid btn-small" disabled={busy} data-testid="stage-req-submit">
              {submitLabel ?? t('stageRules.saveAndMove')}
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

/** Enfoca el primer control del diálogo al abrir (teclado: Enter confirma, Esc cierra). */
function AutoFocus({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, select, textarea, a')?.focus();
  }, []);
  return (
    <span ref={ref} className="stage-req-input">
      {children}
    </span>
  );
}
