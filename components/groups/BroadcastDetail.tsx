'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { BroadcastDto, RecipientDto } from '@/lib/groups-broadcasts';
import { api, useErrorText, useToast } from './ui';

/** Un envío: progreso y estado por destinatario (se actualiza solo mientras manda). */
export default function BroadcastDetail({ initial }: { initial: { broadcast: BroadcastDto; recipients: RecipientDto[] } }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [data, setData] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const b = data.broadcast;
  const live = b.status === 'scheduled' || b.status === 'sending';

  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await api<typeof initial>(`/api/groups/broadcasts/${b.id}`);
      if (res.data) setData(res.data);
    }, 4000);
    return () => clearInterval(id);
  }, [b.id, live]);

  async function cancel() {
    setConfirm(false);
    const res = await api<BroadcastDto>(`/api/groups/broadcasts/${b.id}`, { method: 'PATCH', body: { action: 'cancel' } });
    if (!res.data) return showToast(errText(res.error), true);
    const fresh = await api<typeof initial>(`/api/groups/broadcasts/${b.id}`);
    if (fresh.data) setData(fresh.data);
  }

  const counts = {
    sent: data.recipients.filter((r) => r.status === 'sent').length,
    failed: data.recipients.filter((r) => r.status === 'failed').length,
    pending: data.recipients.filter((r) => r.status === 'pending' || r.status === 'sending').length,
    skipped: data.recipients.filter((r) => r.status === 'skipped').length,
  };
  const pct = data.recipients.length ? Math.round(((counts.sent + counts.failed + counts.skipped) / data.recipients.length) * 100) : 0;

  return (
    <div className="gr-broadcast">
      <div className="gr-stats">
        <div>
          <span className="label">{t('broadcasts.colStatus')}</span>
          <strong>{t(`broadcastStatus.${b.status}`)}</strong>
        </div>
        <div>
          <span className="label">{t('broadcasts.colWhen')}</span>
          <strong>{new Date(b.scheduledAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        </div>
        <div>
          <span className="label">{t('recipientStatus.sent')}</span>
          <strong className="num">{counts.sent}</strong>
        </div>
        <div>
          <span className="label">{t('recipientStatus.failed')}</span>
          <strong className="num">{counts.failed}</strong>
        </div>
        <div>
          <span className="label">{t('recipientStatus.pending')}</span>
          <strong className="num">{counts.pending}</strong>
        </div>
      </div>
      <div className="gr-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('broadcasts.progress')}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="gr-preview">
        <p className="label">{t('broadcasts.message')}</p>
        <p className="gr-bubble gr-pre">{b.body || (b.media ? b.media.name : '')}</p>
        <p className="ui-help">{t('broadcasts.rate', { n: b.perMinute })}</p>
      </div>
      {live && (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirm(true)}>
          {t('broadcasts.cancel')}
        </button>
      )}
      <div className="table-wrap">
        <table className="table gr-table">
          <thead>
            <tr>
              <th>{t('broadcasts.colRecipient')}</th>
              <th>{t('broadcasts.colStatus')}</th>
              <th className="gr-hide-sm">{t('broadcasts.colSentAt')}</th>
            </tr>
          </thead>
          <tbody>
            {data.recipients.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/groups/inbox/${r.chatId}`}>{r.chatName}</Link>
                </td>
                <td>
                  <span className={`badge ${r.status === 'sent' ? 'badge-ok' : r.status === 'failed' ? 'badge-bad' : 'badge-outline'}`}>{t(`recipientStatus.${r.status}`)}</span>
                  {r.error && <span className="ui-help"> {errText(r.error)}</span>}
                </td>
                <td className="gr-hide-sm ui-help">{r.sentAt ? new Date(r.sentAt).toLocaleTimeString(locale) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('broadcasts.cancelTitle')}
        body={t('broadcasts.cancelBody', { n: counts.pending })}
        confirmLabel={t('broadcasts.cancel')}
        cancelLabel={t('common.back')}
        danger
        onConfirm={() => void cancel()}
        onCancel={() => setConfirm(false)}
      />
      {toast}
    </div>
  );
}
