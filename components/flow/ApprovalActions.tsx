'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface Props {
  token: string;
  /** Decisión del link que abrió la página (?decision=approve|reject): queda elegida, no enviada. */
  initial: 'approve' | 'reject' | null;
  expires: string | null;
}

/** Aprobar o rechazar un pedido de un flow, con un comentario opcional. */
export default function ApprovalActions({ token, initial, expires }: Props) {
  const t = useTranslations('flow.approvalPage');
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(null);
    const res = await fetch(`/api/flow/approvals/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, comment }),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? '';
    setError(['not_waiting', 'busy', 'rate_limited'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    if (code === 'not_waiting') router.refresh();
  }

  return (
    <form
      className="fa-form"
      onSubmit={(e) => {
        e.preventDefault();
        void decide(initial ?? 'approve');
      }}
    >
      <div className="ui-field">
        <label className="label" htmlFor="fa-comment">
          {t('comment')} <span className="ui-optional">· {t('optional')}</span>
        </label>
        <textarea
          id="fa-comment"
          className="textarea"
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {initial && <p className="ui-help">{t(initial === 'approve' ? 'confirmApprove' : 'confirmReject')}</p>}
      <div className="fa-actions">
        <button
          type="button"
          className={initial === 'reject' ? 'btn btn-secondary' : 'btn btn-primary'}
          aria-busy={busy === 'approve' || undefined}
          disabled={busy !== null}
          onClick={() => void decide('approve')}
        >
          {t('approve')}
        </button>
        <button
          type="button"
          className={initial === 'reject' ? 'btn btn-primary btn-danger' : 'btn btn-secondary'}
          aria-busy={busy === 'reject' || undefined}
          disabled={busy !== null}
          onClick={() => void decide('reject')}
        >
          {t('reject')}
        </button>
      </div>
      {expires && <p className="ui-help">{expires}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
