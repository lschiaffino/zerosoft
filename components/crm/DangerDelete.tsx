'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';

interface DangerDeleteProps {
  /** Endpoint al que se le hace DELETE (ej. /api/crm/contacts/<id>). */
  endpoint: string;
  /** Texto que hay que tipear para habilitar el botón (ej. el email). */
  confirmToken: string;
  /** Ruta a la que se redirige tras borrar (ej. /app/crm/contacts). */
  redirectTo: string;
  title: string;
  desc: string;
  buttonLabel: string;
}

/** Fila de danger zone: "escribí X para confirmar" → DELETE → redirect. */
export default function DangerDelete({
  endpoint,
  confirmToken,
  redirectTo,
  title,
  desc,
  buttonLabel,
}: DangerDeleteProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (confirmText !== confirmToken) return;
    setBusy(true);
    const res = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push(redirectTo);
      return;
    }
    setBusy(false);
  }

  return (
    <div className="danger-row">
      <div>
        <p className="danger-title">{title}</p>
        <p className="muted danger-desc">{desc}</p>
      </div>
      <div className="danger-delete">
        <input
          className="input mono"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={confirmToken}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-ghost btn-small btn-danger"
          onClick={onDelete}
          disabled={busy || confirmText !== confirmToken}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
