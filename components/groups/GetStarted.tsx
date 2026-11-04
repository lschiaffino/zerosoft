'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { api, useErrorText } from './ui';

/**
 * Los dos caminos de una bandeja sin números: escanear un QR (si el servidor
 * tiene la conexión administrada) o cargar datos de ejemplo. Sin QR
 * administrado, el ejemplo va primero y la conexión propia queda al lado.
 */
export default function GetStarted({ managed, canEdit }: { managed: boolean; canEdit: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canEdit) return <p className="ui-help">{t('sample.askAdmin')}</p>;

  async function load() {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await api('/api/groups/sample', { body: { locale } });
    if (!res.data) {
      setBusy(false);
      setError(errText(res.error));
      return;
    }
    router.refresh();
  }

  const sampleButton = (primary: boolean) => (
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={() => void load()} aria-busy={busy || undefined} disabled={busy}>
      {busy ? t('sample.loading') : t('sample.load')}
    </button>
  );

  return (
    <div className="gr-start">
      <div className="gr-start-actions">
        {managed ? (
          <>
            <Link href="/app/groups/settings?tab=numbers&new=1" className="btn btn-primary">
              {t('inbox.scanQr')}
            </Link>
            {sampleButton(false)}
          </>
        ) : (
          <>
            {sampleButton(true)}
            <Link href="/app/groups/settings?tab=numbers&new=1" className="btn btn-secondary">
              {t('inbox.connect')}
            </Link>
          </>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
