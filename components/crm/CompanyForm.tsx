'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { createFormBody, deriveDomain } from './formPayload';
import { DomainPrefillNote, siteExtras, useDomainPrefill } from './DomainPrefill';
import CreateFormFields, { missingFromResponse, useMissingMessage, useMoreHint, type CreateFormOption } from './CreateFormFields';
import { configuredFields, isRequired, missingRequired, type ResolvedCreateField } from '@/lib/crm-create-form-shared';

/** Códigos de error de la API que tienen traducción en crm.errors.*. */
const KNOWN_ERRORS = new Set([
  'invalid_email',
  'missing_name',
  'not_found',
  'invalid_input',
  'invalid_owner',
  'field_readonly',
  'value_taken',
  'generic',
]);

interface CompanyFormProps {
  /** Formulario de alta configurado (lib/crm-create-form.ts) y el resto de lo editable. */
  form: ResolvedCreateField[];
  more: ResolvedCreateField[];
  people: CreateFormOption[];
  me: string;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/**
 * Alta de empresa: nombre y dominio arriba (el dominio sale del sitio web si
 * lo dejan vacío); después las propiedades que el workspace eligió para el
 * alta (Ajustes › Datos) y el resto en "Más campos".
 */
export default function CompanyForm({ form, more, people, me }: CompanyFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const prefill = useDomainPrefill();
  const missingMessage = useMissingMessage('companies');
  const [domain, setDomain] = useState('');
  const configured = configuredFields('companies', form);
  const moreHint = useMoreHint('companies', more);
  const ctx = { people, me };
  const domainRequired = isRequired('companies', form, 'domain');

  async function onSubmit(fd: FormData) {
    const typed = createFormBody('companies', fd, [...configured, ...more]);
    const name = str(fd, 'name');
    if (!name) return t('errors.missing_name');
    const typedDomain = deriveDomain(str(fd, 'domain'), typeof typed.website === 'string' ? typed.website : undefined);
    // Lo que el sitio publica completa lo que quedó vacío (lo escrito gana).
    const site = prefill.infoFor(typedDomain ?? '');
    const body: Record<string, unknown> = { ...(site ? siteExtras(site) : {}), ...typed, name };
    if (typedDomain) body.domain = typedDomain;
    if (!body.industry && site?.industry) body.industry = site.industry;
    const missing = missingRequired('companies', form, body);
    if (missing.length) return missingMessage(missing, form);
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.status === 201) {
      const created = (await res.json()) as { id: string };
      router.push(`/app/crm/companies/${created.id}`);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    const missingServer = missingFromResponse(data);
    if (missingServer) return missingMessage(missingServer.fields, form, missingServer.labels);
    return t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic');
  }

  return (
    <FormSection
      title={t('record.form.companyTitle')}
      description={t('record.form.companyDesc')}
      submitLabel={t('record.createCompany')}
      onSubmit={onSubmit}
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="co-name">
            {t('companies.form.name')}
            <span className="crm-req" aria-hidden="true">
              {' '}
              *
            </span>
          </label>
          <input id="co-name" name="name" className="input" required maxLength={500} autoComplete="organization" autoFocus />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="co-domain">
            {t('companies.form.domain')}
            {domainRequired && (
              <span className="crm-req" aria-hidden="true">
                {' '}
                *
              </span>
            )}
          </label>
          <input
            id="co-domain"
            name="domain"
            className="input data"
            placeholder="acme.com"
            maxLength={500}
            spellCheck={false}
            aria-describedby="co-domain-help"
            aria-required={domainRequired || undefined}
            onChange={(e) => {
              setDomain(e.target.value);
              prefill.onDomainInput(e.target.value);
            }}
            onBlur={async (e) => {
              const info = await prefill.lookup(e.target.value);
              if (!info) return;
              // Solo completa lo que está vacío: lo que escribió la persona gana.
              const fill = (id: string, value: string) => {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el && !el.value.trim() && value) el.value = value;
              };
              fill('co-name', info.name);
              fill('co-website', info.website);
              fill('co-phone', info.phone);
            }}
          />
          <p className="ui-help" id="co-domain-help">
            {t('record.form.domainHelp')}
          </p>
          <DomainPrefillNote domain={domain} prefill={prefill} />
        </div>
        <CreateFormFields entity="companies" fields={configured} variant="full" idPrefix="co" ctx={ctx} />
      </div>

      {more.length > 0 && (
        <AdvancedSection storageKey="crm.company.new" label={t('record.form.moreFields')} hint={moreHint}>
          <div className="ui-fields-2">
            <CreateFormFields entity="companies" fields={more} variant="full" idPrefix="co" ctx={ctx} />
          </div>
        </AdvancedSection>
      )}
    </FormSection>
  );
}
