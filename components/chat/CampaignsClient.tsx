'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ChatCollection, { type CollectionItem } from './ChatCollection';

interface Campaign extends CollectionItem {
  widget_id: string;
  subject: string;
  body: string;
  audience: string;
  status: 'draft' | 'preparing' | 'sending' | 'sent';
  total: number;
  sent: number;
  failed: number;
  waiting_cap?: boolean;
}

/** Campañas por email a las personas de un widget. Enviar pide confirmar con la cantidad real. */
export default function CampaignsClient({
  widgets,
  companies,
  canManage,
}: {
  widgets: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const t = useTranslations('chat');
  const [confirm, setConfirm] = useState<{ campaign: Campaign; size: number; noOptIn: number; unsubscribed: number; cap: { limit: number; used: number; remaining: number } | null; reload: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function askSend(campaign: Campaign, reload: () => Promise<void>) {
    setError(null);
    const res = await fetch(`/api/chat/campaigns/${campaign.id}`).catch(() => null);
    const data = res?.ok
      ? ((await res.json()) as { audience_size: number; excluded_no_opt_in: number; excluded_unsubscribed: number; cap: { limit: number; used: number; remaining: number } })
      : null;
    setConfirm({ campaign, size: data?.audience_size ?? 0, noOptIn: data?.excluded_no_opt_in ?? 0, unsubscribed: data?.excluded_unsubscribed ?? 0, cap: data?.cap ?? null, reload });
  }

  async function send() {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/campaigns/${confirm.campaign.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const known: Record<string, string> = {
          missing_body: t('campaigns.missingBody'),
          no_recipients: t('campaigns.noRecipients'),
        };
        setError(known[data.error ?? ''] ?? t('errors.generic'));
        return;
      }
      await confirm.reload();
      setConfirm(null);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  const audienceLabel = (a: string) =>
    a.startsWith('company:') ? (companies.find((c) => `company:${c.id}` === a)?.name ?? t('campaigns.audiences.all')) : t(`campaigns.audiences.${a}`);

  return (
    <>
      <ChatCollection<Campaign>
        ns="campaigns"
        api="/api/chat/campaigns"
        listKey="campaigns"
        canManage={canManage}
        defaults={{ widget_id: widgets[0]?.id ?? '', audience: 'all' }}
        locked={() => false}
        fields={[
          { id: 'name', label: t('campaigns.name'), type: 'text', required: true, maxLength: 80 },
          { id: 'widget_id', label: t('campaigns.widget'), type: 'select', required: true, options: widgets.map((w) => ({ value: w.id, label: w.name })) },
          {
            id: 'audience',
            label: t('campaigns.audience'),
            type: 'select',
            options: [
              { value: 'all', label: t('campaigns.audiences.all') },
              { value: 'verified', label: t('campaigns.audiences.verified') },
              ...companies.map((c) => ({ value: `company:${c.id}`, label: c.name })),
            ],
          },
          { id: 'subject', label: t('campaigns.subject'), type: 'text', maxLength: 200 },
          { id: 'body', label: t('campaigns.body'), type: 'textarea', maxLength: 20000, help: t('campaigns.bodyHelp') },
        ]}
        columns={[
          { label: t('campaigns.name'), render: (c) => c.name },
          { label: t('campaigns.audience'), render: (c) => audienceLabel(c.audience) },
          { label: t('campaigns.status'), render: (c) => t(`campaigns.statuses.${c.status}`) },
          { label: t('campaigns.results'), render: (c) => (c.status === 'draft' ? '–' : `${t('campaigns.counts', { sent: c.sent, total: c.total, failed: c.failed })}${c.waiting_cap ? ` ${t('campaigns.waitingCap')}` : ''}`) },
        ]}
        rowActions={(c, reload) =>
          canManage && c.status === 'draft' ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void askSend(c, reload)}>
              {t('campaigns.send')}
            </button>
          ) : null
        }
      />
      <ConfirmDialog
        open={confirm !== null}
        title={t('campaigns.confirmTitle')}
        confirmLabel={confirm?.size === 0 ? t('common.close') : t('campaigns.send')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm?.size === 0 ? setConfirm(null) : void send())}
        body={
          confirm && (
            <>
              <p>{t('campaigns.confirmBody', { name: confirm.campaign.name, count: confirm.size })}</p>
              {confirm.noOptIn > 0 && <p className="ui-help">{t('campaigns.excludedNoOptIn', { count: confirm.noOptIn })}</p>}
              {confirm.unsubscribed > 0 && <p className="ui-help">{t('campaigns.excludedUnsubscribed', { count: confirm.unsubscribed })}</p>}
              {confirm.cap && <p className="ui-help">{t('campaigns.capNote', { limit: confirm.cap.limit, remaining: confirm.cap.remaining })}</p>}
              {confirm.size === 0 && <p className="ui-error">{t('campaigns.noRecipients')}</p>}
              {confirm.cap && confirm.size > confirm.cap.remaining && <p className="ui-help">{t('campaigns.overCap', { now: confirm.cap.remaining, later: confirm.size - confirm.cap.remaining })}</p>}
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )
        }
      />
    </>
  );
}
