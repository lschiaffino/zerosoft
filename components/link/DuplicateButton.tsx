'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import LinkIcon from './LinkIcon';

interface DuplicateButtonProps {
  id: string;
  className?: string;
  /** Solo ícono (fila de la tabla); el texto queda como aria-label. */
  iconOnly?: boolean;
  /** Para el aria-label de la fila ("Duplicar: zerosoft.ai/abc"). */
  subject?: string;
}

/** Crea una copia del link con un slug nuevo y abre sus ajustes para cambiar lo que haga falta. */
export default function DuplicateButton({ id, className = 'btn btn-ghost', iconOnly = false, subject }: DuplicateButtonProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/links/${id}/duplicate`, { method: 'POST' }).catch(() => null);
    if (res?.status === 201) {
      const created = (await res.json()) as { id: string };
      router.push(`/app/links/${created.id}?tab=settings`);
      return;
    }
    setBusy(false);
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  const label = t('common.duplicate');
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={duplicate}
        disabled={busy}
        aria-busy={busy || undefined}
        title={iconOnly ? label : undefined}
        aria-label={iconOnly ? (subject ? `${label}: ${subject}` : label) : undefined}
      >
        <LinkIcon name="duplicate" size={iconOnly ? 14 : 15} />
        {!iconOnly && label}
      </button>
      {error && (
        <span className="ui-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
