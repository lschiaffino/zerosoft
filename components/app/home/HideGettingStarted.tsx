'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/app/icons';

/** Oculta "Primeros pasos" (queda en el perfil: no vuelve en otro dispositivo). */
export default function HideGettingStarted({ label, ariaLabel, error }: { label: string; ariaLabel: string; error: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function hide() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'checklist', dismissed: true }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    // El bloque desaparece al instante; el refresh trae el inicio sin él.
    document.querySelector('[data-testid="getting-started"]')?.setAttribute('hidden', '');
    router.refresh();
  }

  return (
    <>
      {failed && (
        <span className="ui-error gs-error" role="alert">
          {error}
        </span>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void hide()} disabled={busy} aria-busy={busy || undefined} aria-label={ariaLabel} data-testid="getting-started-hide">
        <Icon name="close" size={14} />
        {label}
      </button>
    </>
  );
}
