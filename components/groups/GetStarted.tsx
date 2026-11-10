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
export default function GetStarted({
  managed,
  canEdit,
  finish = false,
  inline = false,
}: {
  managed: boolean;
  canEdit: boolean;
  /** Ya hay un número sin conectar: el link lleva a terminar la conexión. */
  finish?: boolean;
  /** Dentro de un aviso: botones chicos en línea. */
  inline?: boolean;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canEdit) return inline ? null : <p className="ui-help">{t('sample.askAdmin')}</p>;
  const size = inline ? ' btn-sm' : '';
  const connectHref = finish ? '/app/lines/settings?tab=numbers' : '/app/lines/settings?tab=numbers&new=1';
  const connectLabel = finish ? t('inbox.finishConnect') : managed ? t('inbox.scanQr') : t('inbox.connect');

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
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}${size}`} onClick={() => void load()} aria-busy={busy || undefined} disabled={busy}>
      {busy ? t('sample.loading') : t('sample.load')}
    </button>
  );

  return (
    <div className={`gr-start${inline ? ' is-inline' : ''}`}>
      <div className="gr-start-actions">
        {managed || finish ? (
          <>
            <Link href={connectHref} className={`btn btn-primary${size}`}>
              {connectLabel}
            </Link>
            {sampleButton(false)}
          </>
        ) : (
          <>
            {sampleButton(true)}
            <Link href={connectHref} className={`btn btn-secondary${size}`}>
              {connectLabel}
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
