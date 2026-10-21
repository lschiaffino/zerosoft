'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { normalizeCompanyDomain } from '@/lib/crm-domain';
import CompanyLogo from './CompanyLogo';

export interface DomainInfo {
  domain: string;
  name: string;
  website: string;
  phone: string;
  existing: { id: string; name: string } | null;
}

/**
 * Precarga de una empresa nueva desde su dominio: al salir del campo busca
 * nombre, sitio y teléfono en la home (server-side) y avisa si ya hay una
 * empresa con ese dominio. `lookup` devuelve null si no hay nada que usar.
 */
export function useDomainPrefill() {
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const last = useRef('');

  async function lookup(raw: string): Promise<DomainInfo | null> {
    const domain = normalizeCompanyDomain(raw);
    if (!domain || domain === last.current) return null;
    last.current = domain;
    setLoading(true);
    const res = await fetch(`/api/crm/companies/enrich?domain=${encodeURIComponent(domain)}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setInfo(null);
      return null;
    }
    const data = (await res.json().catch(() => null)) as DomainInfo | null;
    setInfo(data);
    return data;
  }

  return { info, loading, lookup };
}

/** Nota bajo el campo de dominio: logo y lo que se precargó, o el aviso de duplicado. */
export function DomainPrefillNote({ info, loading }: { info: DomainInfo | null; loading: boolean }) {
  const t = useTranslations('crm');
  if (loading) {
    return (
      <p className="ui-help co-enrich-note" aria-live="polite">
        {t('companies.enrich.looking')}
      </p>
    );
  }
  if (!info) return null;
  return (
    <p className="ui-help co-enrich-note record-title-logo" aria-live="polite">
      <CompanyLogo domain={info.domain} name={info.name || info.domain} size={16} />
      {info.existing ? (
        <span>
          {t('companies.enrich.exists')}{' '}
          <Link href={`/app/crm/companies/${info.existing.id}`}>{info.existing.name}</Link>
        </span>
      ) : (
        <span>{t('companies.enrich.filled', { domain: info.domain })}</span>
      )}
    </p>
  );
}
