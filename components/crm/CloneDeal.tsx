'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { missingFromResponse, useMissingMessage } from './CreateFormFields';

interface CloneDealProps {
  /** Cuerpo ya armado para POST /api/crm/deals (lib/crm-deal-clone.ts). */
  body: Record<string, unknown>;
  name: string;
}

/** Panel "Clonar deal": confirma y crea la copia, y abre el deal nuevo. */
export default function CloneDeal({ body, name }: CloneDealProps) {
  const t = useTranslations('crm.deals.detail');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const missingMessage = useMissingMessage('deals');
  /** null = sin error; '' = error genérico; texto = obligatorias del formulario de alta que faltan. */
  const [failed, setFailed] = useState<string | null>(null);

  async function onClone() {
    setBusy(true);
    setFailed(null);
    const res = await fetch('/api/crm/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { id?: string } | null) : null;
    if (res && res.status === 201 && data?.id) {
      router.push(`/app/crm/deals/${data.id}`);
      return;
    }
    // El formulario de alta pide propiedades que el deal original no tiene.
    const missing = missingFromResponse(data);
    setFailed(missing ? missingMessage(missing.fields, [], missing.labels) : '');
    setBusy(false);
  }

  return (
    <div>
      <p className="muted">{t('cloneDesc', { name })}</p>
      <div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClone} disabled={busy} autoFocus>
          {busy ? t('cloning') : t('cloneButton')}
        </button>
      </div>
      {failed !== null && (
        <p className="form-error" role="alert">
          {failed || t('cloneError')}
        </p>
      )}
    </div>
  );
}
