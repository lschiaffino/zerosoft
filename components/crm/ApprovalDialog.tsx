'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { parseDbUtc } from '@/lib/utils';

/** Lo que devuelve /move con 409 approval_required (y el dryRun en `approval`). */
export interface ApprovalInfo {
  stage: string;
  stageId: string;
  approvers: Array<{ id: string; name: string }>;
  pending: { id: string; created_at: string; requested_by: string | null; requested_by_name: string; note: string } | null;
}

/** Lee el cuerpo de un 409 de /move; null si es otro error. No consume el body. */
export async function readApproval(res: Response | null): Promise<ApprovalInfo | null> {
  if (!res || res.status !== 409) return null;
  const body = (await res.clone().json().catch(() => null)) as (ApprovalInfo & { error?: string }) | null;
  return body?.error === 'approval_required' && Array.isArray(body.approvers) ? body : null;
}

interface ApprovalDialogProps {
  dealId: string;
  info: ApprovalInfo;
  onClose: () => void;
  locale?: string;
}

/**
 * La etapa pide aprobación: se pide acá (con una nota para los aprobadores) o
 * se ve el pedido abierto y se puede cancelar. Modal nativo: foco atrapado,
 * Esc cierra, Enter en el botón pide.
 */
export default function ApprovalDialog({ dealId, info, onClose, locale = 'en' }: ApprovalDialogProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'requested' | 'cancelled' | null>(null);
  const [pending, setPending] = useState(info.pending);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const names = info.approvers.map((a) => a.name).filter(Boolean).join(', ');
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parseDbUtc(iso));

  async function request() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/deals/${dealId}/approvals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: info.stageId, note: note.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('approvals.requestError'));
      return;
    }
    const data = (await res.json().catch(() => null)) as { approval?: { id: string; created_at: string; note: string } } | null;
    if (data?.approval) setPending({ id: data.approval.id, created_at: data.approval.created_at, requested_by: null, requested_by_name: '', note: data.approval.note });
    setDone('requested');
    router.refresh();
  }

  async function cancel() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/approvals/${pending.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('approvals.decideError'));
      return;
    }
    setPending(null);
    setDone('cancelled');
    router.refresh();
  }

  return (
    <dialog
      ref={ref}
      className="ui-modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      data-testid="approval-dialog"
    >
      <div className="ui-modal-head">
        <h2 id={titleId} className="ui-modal-title">
          {t('approvals.dialogTitle', { stage: info.stage })}
        </h2>
      </div>
      <div className="ui-modal-body appr-dialog">
        <p>{names ? t('approvals.needsFrom', { names }) : t('approvals.needs')}</p>
        {done === 'requested' ? (
          <p className="ui-help" role="status">
            {t('approvals.requested')}
          </p>
        ) : done === 'cancelled' ? (
          <p className="ui-help" role="status">
            {t('approvals.cancelled')}
          </p>
        ) : pending ? (
          <p className="ui-help">
            {pending.requested_by_name
              ? t('approvals.pendingBy', { name: pending.requested_by_name, date: fmt(pending.created_at) })
              : t('approvals.pendingSince', { date: fmt(pending.created_at) })}
          </p>
        ) : (
          <label className="field">
            <span className="prop-label">{t('approvals.note')}</span>
            <textarea
              className="textarea"
              rows={3}
              maxLength={2000}
              value={note}
              placeholder={t('approvals.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          {!done && !pending && (
            <button type="button" className="btn btn-solid btn-small" disabled={busy} onClick={() => void request()} data-testid="approval-request">
              {t('approvals.request')}
            </button>
          )}
          {!done && pending && (
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void cancel()} data-testid="approval-cancel">
              {t('approvals.cancelRequest')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => ref.current?.close()}>
            {done ? t('record.close') : t('common.cancel')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
