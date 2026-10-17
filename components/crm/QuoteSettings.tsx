'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';

/** Ajustes › Ventas › Cotizaciones: qué pasa con el deal cuando aceptan una cotización. */
export default function QuoteSettings({ quoteAcceptMovesDeal, canEdit }: { quoteAcceptMovesDeal: boolean; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [moves, setMoves] = useState(quoteAcceptMovesDeal);

  async function save() {
    const res = await fetch('/api/crm/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteAcceptMovesDeal: moves }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      return data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}` as 'errors.generic') : t('errors.generic');
    }
    router.refresh();
  }

  return (
    <FormSection
      title={t('settings.quotesTitle')}
      description={t('settings.quotesDesc')}
      onSubmit={save}
      disabled={!canEdit}
      note={canEdit ? undefined : t('common.adminOnly')}
    >
      <label className="ui-switch">
        <input
          type="checkbox"
          role="switch"
          name="quoteAcceptMovesDeal"
          checked={moves}
          onChange={(e) => setMoves(e.target.checked)}
          disabled={!canEdit}
          data-testid="quote-moves-deal"
        />
        {t('currency.quoteMovesDeal')}
      </label>
    </FormSection>
  );
}
