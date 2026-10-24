'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * "Completar desde el sitio": trae nombre, descripción, rubro, tamaño,
 * ubicación y redes del dominio de la empresa y llena lo vacío (o todo, si
 * se marca reemplazar). Avisa cuántos campos completó.
 */
export default function CompanyEnrichButton({ companyId, domain, enriched }: { companyId: string; domain: string; enriched: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(overwrite: boolean) {
    setBusy(true);
    setNote(null);
    setError(null);
    const res = await fetch(`/api/crm/companies/${companyId}/enrich`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overwrite }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const data = (await res.json()) as { filled: string[] };
      setNote(data.filled.length ? t('companiesEnrich.done', { count: data.filled.length, domain }) : t('companiesEnrich.nothing', { domain }));
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <span className="co-enrich-action">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => void run(false)}
        disabled={busy}
        aria-busy={busy || undefined}
        data-testid="company-enrich"
      >
        {busy ? t('companiesEnrich.busy') : enriched ? t('companiesEnrich.refresh') : t('companiesEnrich.action')}
      </button>
      {(note || error) && (
        <span className={error ? 'ui-error co-enrich-msg' : 'saved-note co-enrich-msg'} role={error ? 'alert' : 'status'}>
          {error ?? note}
        </span>
      )}
    </span>
  );
}
