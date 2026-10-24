'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** Aprobar / rechazar / cancelar desde la lista de pedidos. */
export default function ApprovalRowActions({ id, canDecide, canCancel }: { id: string; canDecide: boolean; canCancel: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(action: 'approve' | 'reject' | 'cancel') {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/approvals/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  return (
    <span className="appr-row-actions">
      {canDecide && (
        <>
          <button type="button" className="btn btn-solid btn-small" disabled={busy} onClick={() => void act('approve')} data-testid="approval-row-approve">
            {t('approvals.approve')}
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void act('reject')} data-testid="approval-row-reject">
            {t('approvals.reject')}
          </button>
        </>
      )}
      {!canDecide && canCancel && (
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void act('cancel')}>
          {t('approvals.cancelRequest')}
        </button>
      )}
      {error && (
        <span className="form-error" role="alert">
          {t('approvals.decideError')}
        </span>
      )}
    </span>
  );
}
