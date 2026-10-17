'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import CalIcon from './cal-icons';

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
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
    setBusy(false);
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onClick} aria-busy={busy || undefined}>
        <CalIcon name="trash" />
        {t('common.delete')}
      </button>
      {error && (
        <p className="ui-error cal-delete-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
