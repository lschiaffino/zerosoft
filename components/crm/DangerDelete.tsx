'use client';

import { useId, useState } from 'react';
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
  /** Label del campo de confirmación ("Escribí … para confirmar"). */
  confirmLabel?: string;
  /** Texto si el DELETE falla. */
  errorLabel?: string;
  /** Sin título: cuando el contenedor (modal) ya lo muestra. */
  bare?: boolean;
}

/** Fila de danger zone: "escribí X para confirmar" → DELETE → redirect. */
export default function DangerDelete({
  endpoint,
  confirmToken,
  redirectTo,
  title,
  desc,
  buttonLabel,
  confirmLabel,
  errorLabel,
  bare = false,
}: DangerDeleteProps) {
  const inputId = useId();
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (confirmText !== confirmToken) return;
    setBusy(true);
    setFailed(false);
    const res = await fetch(endpoint, { method: 'DELETE' }).catch(() => null);
    if (res && res.status === 204) {
      router.push(redirectTo);
      return;
    }
    setFailed(true);
    setBusy(false);
  }

  return (
    <div className="danger-row">
      <div>
        {!bare && <p className="danger-title">{title}</p>}
        <p className="muted danger-desc">{desc}</p>
      </div>
      <div className="danger-delete">
        {confirmLabel && (
          <label className="label" htmlFor={inputId}>
            {confirmLabel}
          </label>
        )}
        <input
          id={inputId}
          className="input data"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={confirmToken}
          aria-label={confirmLabel ? undefined : title}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-primary btn-danger btn-sm"
          onClick={onDelete}
          aria-busy={busy || undefined}
          disabled={busy || confirmText !== confirmToken}
        >
          {buttonLabel}
        </button>
        {failed && errorLabel && (
          <p className="ui-error" role="alert">
            {errorLabel}
          </p>
        )}
      </div>
    </div>
  );
}
