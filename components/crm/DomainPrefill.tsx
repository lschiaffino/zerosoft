'use client';

import { useEffect, useRef, useState } from 'react';
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

export interface ExistingCompany {
  domain: string;
  existing: { id: string; name: string } | null;
}

/** Espera antes de buscar duplicados mientras se escribe el dominio. */
const DUP_DEBOUNCE_MS = 450;

/** Un dominio con pinta de completo (algo.tld): recién ahí vale la pena preguntar. */
function looksComplete(domain: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain);
}

/**
 * Precarga de una empresa nueva desde su dominio: al salir del campo busca
 * nombre, sitio y teléfono en la home (server-side). Aparte, mientras se
 * escribe, pregunta (rápido, solo la base) si ya hay una empresa con ese
 * dominio, para avisar antes de crear un duplicado.
 */
export function useDomainPrefill() {
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [dup, setDup] = useState<ExistingCompany | null>(null);
  const last = useRef('');
  /** Búsqueda del sitio en curso (o la última), por dominio normalizado. */
  const inflight = useRef<{ domain: string; promise: Promise<DomainInfo | null> } | null>(null);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dupFor = useRef('');

  useEffect(
    () => () => {
      if (dupTimer.current) clearTimeout(dupTimer.current);
    },
    [],
  );

  function fetchInfo(domain: string): Promise<DomainInfo | null> {
    if (inflight.current?.domain === domain) return inflight.current.promise;
    setLoading(true);
    const promise = fetch(`/api/crm/companies/enrich?domain=${encodeURIComponent(domain)}`)
      .then(async (res) => (res.ok ? ((await res.json().catch(() => null)) as DomainInfo | null) : null))
      .catch(() => null)
      .then((data) => {
        // Si mientras tanto cambió el dominio, esta respuesta ya no se muestra.
        if (inflight.current?.domain === domain) {
          setLoading(false);
          setInfo(data);
          if (data) setDup({ domain, existing: data.existing });
        }
        return data;
      });
    inflight.current = { domain, promise };
    return promise;
  }

  /** Al salir del campo: null si no hay nada nuevo que usar (mismo dominio que la vez anterior). */
  async function lookup(raw: string): Promise<DomainInfo | null> {
    const domain = normalizeCompanyDomain(raw);
    if (!domain || domain === last.current) return null;
    last.current = domain;
    return fetchInfo(domain);
  }

  /** Solo el chequeo de duplicado (sin ir al sitio): rápido, para el submit y mientras se escribe. */
  async function checkExisting(raw: string): Promise<ExistingCompany | null> {
    const domain = normalizeCompanyDomain(raw);
    if (!domain) return null;
    if (dup?.domain === domain) return dup;
    dupFor.current = domain;
    const res = await fetch(`/api/crm/companies/enrich?domain=${encodeURIComponent(domain)}&check=1`).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as ExistingCompany | null) : null;
    const result = data ? { domain, existing: data.existing ?? null } : null;
    if (result && dupFor.current === domain) setDup(result);
    return result;
  }

  /** onChange del campo: busca duplicados con un respiro, sin mover nada hasta que haya respuesta. */
  function onDomainInput(raw: string) {
    if (dupTimer.current) clearTimeout(dupTimer.current);
    const domain = normalizeCompanyDomain(raw);
    dupFor.current = domain;
    if (!domain || !looksComplete(domain)) return;
    dupTimer.current = setTimeout(() => void checkExisting(domain), DUP_DEBOUNCE_MS);
  }

  /** Lo precargado solo si sigue siendo el dominio del campo. */
  function infoFor(raw: string): DomainInfo | null {
    const domain = normalizeCompanyDomain(raw);
    return info && domain && info.domain === domain ? info : null;
  }

  /** Empresa existente con el dominio del campo (si ya se sabe). */
  function existingFor(raw: string): ExistingCompany['existing'] {
    const domain = normalizeCompanyDomain(raw);
    return dup && domain && dup.domain === domain ? dup.existing : null;
  }

  return { info, loading, lookup, checkExisting, onDomainInput, infoFor, existingFor };
}

/**
 * Nota bajo el campo de dominio: logo y lo que se precargó, o el aviso de
 * duplicado. `domain` es el valor actual del campo: lo que se sabe de otro
 * dominio no se muestra.
 */
export function DomainPrefillNote({
  domain,
  prefill,
  className = '',
}: {
  domain: string;
  prefill: ReturnType<typeof useDomainPrefill>;
  className?: string;
}) {
  const t = useTranslations('crm');
  const existing = prefill.existingFor(domain);
  const info = prefill.infoFor(domain);
  const normalized = normalizeCompanyDomain(domain);
  if (existing) {
    return (
      <p className={`ui-help co-enrich-note co-enrich-dup record-title-logo ${className}`} role="status" data-testid="company-dup-warning">
        <CompanyLogo domain={normalized} name={existing.name} size={16} />
        <span>
          {t('companies.enrich.exists')}{' '}
          <Link href={`/app/crm/companies/${existing.id}`}>{existing.name}</Link>
        </span>
      </p>
    );
  }
  if (prefill.loading) {
    return (
      <p className={`ui-help co-enrich-note ${className}`} aria-live="polite">
        {t('companies.enrich.looking')}
      </p>
    );
  }
  if (!info) return className ? <p className={`ui-help co-enrich-note ${className}`} aria-hidden="true" /> : null;
  return (
    <p className={`ui-help co-enrich-note record-title-logo ${className}`} aria-live="polite">
      <CompanyLogo domain={info.domain} name={info.name || info.domain} size={16} />
      <span>{t('companies.enrich.filled', { domain: info.domain })}</span>
    </p>
  );
}
