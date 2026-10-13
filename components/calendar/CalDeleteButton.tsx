'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface CalDeleteButtonProps {
  /** Endpoint DELETE del recurso. */
  url: string;
  confirmText: string;
  /** Adónde volver después de borrar. */
  redirectTo: string;
}

/** Botón "Eliminar" con confirmación para la cabecera de un detalle de Cal. */
export default function CalDeleteButton({ url, confirmText, redirectTo }: CalDeleteButtonProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function onClick() {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(false);
    const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    setBusy(false);
    setError(true);
  }

  return (
    <button
      type="button"
      className="btn btn-small btn-ghost cal-delete-btn"
      onClick={onClick}
      disabled={busy}
      title={error ? t('errors.generic') : undefined}
    >
      {busy ? t('common.deleting') : error ? t('errors.generic') : t('common.delete')}
    </button>
  );
}
