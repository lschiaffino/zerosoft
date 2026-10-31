'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import QuickModal from '@/components/app/QuickModal';
import ChatCollection, { type CollectionItem } from './ChatCollection';

interface Campaign extends CollectionItem {
  widget_id: string;
  subject: string;
  body: string;
  audience: string;
  status: 'draft' | 'sending' | 'sent';
  total: number;
  sent: number;
  failed: number;
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
  const [confirm, setConfirm] = useState<{ campaign: Campaign; size: number; reload: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function askSend(campaign: Campaign, reload: () => Promise<void>) {
    setError(null);
    const res = await fetch(`/api/chat/campaigns/${campaign.id}`).catch(() => null);
    const data = res?.ok ? ((await res.json()) as { audience_size: number }) : null;
    setConfirm({ campaign, size: data?.audience_size ?? 0, reload });
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
        setError(data.error === 'missing_body' ? t('campaigns.missingBody') : t('errors.generic'));
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
          { label: t('campaigns.results'), render: (c) => (c.status === 'draft' ? '–' : t('campaigns.counts', { sent: c.sent, total: c.total, failed: c.failed })) },
        ]}
        rowActions={(c, reload) =>
          canManage && c.status === 'draft' ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void askSend(c, reload)}>
              {t('campaigns.send')}
            </button>
          ) : null
        }
      />
      <QuickModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('campaigns.confirmTitle')}
        onSubmit={() => void send()}
        submitLabel={t('campaigns.send')}
        cancelLabel={t('common.cancel')}
        busy={busy}
        error={error}
        centered
      >
        <p>{t('campaigns.confirmBody', { name: confirm?.campaign.name ?? '', count: confirm?.size ?? 0 })}</p>
      </QuickModal>
    </>
  );
}
