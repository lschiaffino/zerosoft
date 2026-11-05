'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

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
  const [failed, setFailed] = useState(false);

  async function onClone() {
    setBusy(true);
    setFailed(false);
    const res = await fetch('/api/crm/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.status === 201) {
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      if (created?.id) {
        router.push(`/app/crm/deals/${created.id}`);
        return;
      }
    }
    setFailed(true);
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
      {failed && (
        <p className="form-error" role="alert">
          {t('cloneError')}
        </p>
      )}
    </div>
  );
}
