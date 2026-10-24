'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface ApprovalBannerItem {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  stageName: string;
  requestedBy: string | null;
  requestedByName: string;
  approverIds: string[];
  approverNames: string;
  note: string;
  decidedByName: string;
  decisionNote: string;
  when: string;
  consumed: boolean;
}

interface ApprovalBannerProps {
  approval: ApprovalBannerItem;
  me: string;
}

/**
 * Pedido de aprobación del deal: el pendiente (con aprobar / rechazar para
 * los aprobadores y cancelar para quien lo pidió) o el último resuelto.
 */
export default function ApprovalBanner({ approval, me }: ApprovalBannerProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isApprover = approval.approverIds.includes(me);
  const isRequester = approval.requestedBy === me;

  async function act(action: 'approve' | 'reject' | 'cancel') {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/approvals/${approval.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, note: note.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('approvals.decideError'));
      return;
    }
    const data = (await res.json().catch(() => null)) as { moved?: boolean; missing?: string[] } | null;
    if (action === 'approve' && data && !data.moved) setMessage(t('approvals.approvedNotMoved'));
    router.refresh();
  }

  const tone = approval.status === 'pending' ? 'is-pending' : approval.status === 'approved' ? 'is-ok' : 'is-bad';
  return (
    <section className={`appr-banner ${tone}`} aria-label={t('approvals.title')} data-testid="approval-banner">
      <p className="appr-line">
        <strong>{t(`approvals.status.${approval.status}`, { stage: approval.stageName })}</strong>{' '}
        <span className="muted">
          {approval.status === 'pending'
            ? t('approvals.pendingLine', { name: approval.requestedByName || t('approvals.someone'), date: approval.when, approvers: approval.approverNames })
            : t('approvals.decidedLine', { name: approval.decidedByName || t('approvals.someone'), date: approval.when })}
        </span>
      </p>
      {approval.note && <p className="appr-note">“{approval.note}”</p>}
      {approval.status !== 'pending' && approval.decisionNote && <p className="appr-note">“{approval.decisionNote}”</p>}
      {approval.status === 'approved' && !approval.consumed && <p className="ui-help">{t('approvals.approvedNotMoved')}</p>}
      {approval.status === 'pending' && isApprover && (
        <div className="appr-decide">
          <textarea
            className="textarea"
            rows={2}
            maxLength={2000}
            value={note}
            placeholder={t('approvals.decisionNote')}
            aria-label={t('approvals.decisionNote')}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="form-actions">
            <button type="button" className="btn btn-solid btn-small" disabled={busy} onClick={() => void act('approve')} data-testid="approval-approve">
              {t('approvals.approve')}
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act('reject')} data-testid="approval-reject">
              {t('approvals.reject')}
            </button>
            {isRequester && (
              <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void act('cancel')}>
                {t('approvals.cancelRequest')}
              </button>
            )}
          </div>
        </div>
      )}
      {approval.status === 'pending' && !isApprover && isRequester && (
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void act('cancel')} data-testid="approval-banner-cancel">
            {t('approvals.cancelRequest')}
          </button>
        </div>
      )}
      {message && (
        <p className="ui-help" role="status">
          {message}
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
