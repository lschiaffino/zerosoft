'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { api, useErrorText, useToast } from './ui';

/**
 * Aviso de datos de ejemplo arriba de la bandeja: lo que se manda no sale a
 * WhatsApp, cómo conectar el número real y borrar todo el ejemplo de una vez.
 */
export default function SampleBanner({ canEdit, managed, onlySample }: { canEdit: boolean; managed: boolean; onlySample: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const locale = useLocale();
  const [toast, showToast] = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clear() {
    setConfirming(false);
    setBusy(true);
    const res = await api('/api/groups/sample', { method: 'DELETE' });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    // Carga completa: la lista, el chat abierto y los contadores se van todos juntos, sin esperar al próximo refresco.
    window.location.assign(`/${locale}/app/lines/inbox`);
  }

  return (
    <div className="gr-banner gr-sample-banner" role="status">
      <span>{t('sample.banner')}</span>
      {canEdit && (
        <span className="gr-sample-actions">
          {onlySample && (
            <Link href="/app/lines/settings?tab=numbers&new=1" className="btn btn-ghost btn-sm">
              {managed ? t('inbox.scanQr') : t('inbox.connect')}
            </Link>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} disabled={busy} aria-busy={busy || undefined}>
            {t('sample.clear')}
          </button>
        </span>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('sample.clearTitle')}
        body={t('sample.clearBody')}
        confirmLabel={t('sample.clear')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void clear()}
        onCancel={() => setConfirming(false)}
      />
      {toast}
    </div>
  );
}
