'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { companyPayload } from './formPayload';
import { DomainPrefillNote, useDomainPrefill } from './DomainPrefill';

/** Códigos de error de la API que tienen traducción en crm.errors.*. */
const KNOWN_ERRORS = new Set(['invalid_email', 'missing_name', 'not_found', 'invalid_input', 'generic']);

interface CompanyFormProps {
  lifecycles: Array<{ value: string; label: string }>;
}

/**
 * Alta de empresa: nombre y dominio a la vista (el dominio sale del sitio web
 * si lo dejan vacío); industria, tamaño, contacto y ubicación en "Más campos".
 */
export default function CompanyForm({ lifecycles }: CompanyFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const prefill = useDomainPrefill();
  const [domain, setDomain] = useState('');

  async function onSubmit(fd: FormData) {
    const body = companyPayload(fd);
    if (!body.name) return t('errors.missing_name');
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
          </label>
          <input id="co-name" name="name" className="input" required maxLength={500} autoComplete="organization" autoFocus />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="co-domain">
            {t('companies.form.domain')}
          </label>
          <input
            id="co-domain"
            name="domain"
            className="input data"
            placeholder="acme.com"
            maxLength={500}
            spellCheck={false}
            aria-describedby="co-domain-help"
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
      </div>

      <AdvancedSection
        storageKey="crm.company.new"
        label={t('record.form.moreFields')}
        hint={t('record.form.companyMoreHint')}
      >
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="co-industry">
              {t('companies.form.industry')}
            </label>
            <input id="co-industry" name="industry" className="input" maxLength={500} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-employees">
              {t('companies.form.employees')}
            </label>
            <input id="co-employees" name="employees" className="input" type="number" min={0} inputMode="numeric" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-phone">
              {t('companies.form.phone')}
            </label>
            <input id="co-phone" name="phone" className="input" type="tel" maxLength={500} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-website">
              {t('companies.form.website')}
            </label>
            <input id="co-website" name="website" className="input" type="url" inputMode="url" placeholder="https://" maxLength={500} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-city">
              {t('companies.form.city')}
            </label>
            <input id="co-city" name="city" className="input" maxLength={500} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-country">
              {t('companies.form.country')}
            </label>
            <input id="co-country" name="country" className="input" maxLength={500} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="co-lifecycle">
              {t('companies.form.lifecycle')}
            </label>
            <select id="co-lifecycle" name="lifecycleStage" className="select" defaultValue="lead">
              {lifecycles.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </AdvancedSection>
    </FormSection>
  );
}
