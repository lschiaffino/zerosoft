'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import CustomFieldInput from './CustomFieldInput';
import { contactPayload, type CustomFieldDef } from './formPayload';

export type { CustomFieldDef } from './formPayload';

interface ContactFormProps {
  companies: Array<{ id: string; name: string }>;
  customFields: CustomFieldDef[];
  lifecycles: string[];
  leadStatuses: string[];
  sources: string[];
  /** Company preseleccionada (p.ej. ?companyId= desde el detalle de company). */
  defaultCompanyId?: string;
}

const ERROR_CODES = ['invalid_email', 'missing_name', 'invalid_input', 'invalid_company', 'invalid_owner'] as const;

/**
 * Alta de contacto. Lo básico (nombre, apellido, email, teléfono, empresa)
 * a la vista; cargo, web, ubicación, lifecycle, origen y campos propios en
 * "Más campos". Un solo botón: Crear contacto.
 */
export default function ContactForm({
  companies,
  customFields,
  lifecycles,
  leadStatuses,
  sources,
  defaultCompanyId,
}: ContactFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();

  async function onSubmit(fd: FormData) {
    const body = contactPayload(fd, customFields);
    const res = await fetch('/api/crm/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (res && res.status === 201) {
      const contact = (await res.json()) as { id: string };
      router.push(`/app/crm/contacts/${contact.id}`);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    return (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic');
  }

  return (
    <FormSection
      title={t('record.form.contactTitle')}
      description={t('record.form.contactDesc')}
      submitLabel={t('record.createContact')}
      onSubmit={onSubmit}
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="cf-first">
            {t('contacts.form.firstName')}
          </label>
          <input id="cf-first" name="firstName" className="input" autoComplete="given-name" autoFocus />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="cf-last">
            {t('contacts.form.lastName')}
          </label>
          <input id="cf-last" name="lastName" className="input" autoComplete="family-name" />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="cf-email">
            {t('contacts.form.email')}
          </label>
          <input id="cf-email" name="email" className="input" type="email" autoComplete="email" spellCheck={false} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="cf-phone">
            {t('contacts.form.phone')}
          </label>
          <input id="cf-phone" name="phone" className="input" type="tel" autoComplete="tel" />
        </div>
      </div>
      <div className="ui-field">
        <label className="label" htmlFor="cf-company">
          {t('contacts.form.company')}
        </label>
        <select id="cf-company" name="companyId" className="select" defaultValue={defaultCompanyId ?? ''}>
          <option value="">{t('contacts.form.noCompany')}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <AdvancedSection
        storageKey="crm.contact.new"
        label={t('record.form.moreFields')}
        hint={t('record.form.contactMoreHint')}
      >
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="cf-job">
              {t('contacts.form.jobTitle')}
            </label>
            <input id="cf-job" name="jobTitle" className="input" autoComplete="organization-title" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-web">
              {t('contacts.form.website')}
            </label>
            <input id="cf-web" name="website" className="input" type="url" inputMode="url" placeholder="https://" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-city">
              {t('contacts.form.city')}
            </label>
            <input id="cf-city" name="city" className="input" autoComplete="address-level2" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-country">
              {t('contacts.form.country')}
            </label>
            <input id="cf-country" name="country" className="input" autoComplete="country-name" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-lifecycle">
              {t('contacts.form.lifecycle')}
            </label>
            <select id="cf-lifecycle" name="lifecycleStage" className="select" defaultValue="lead">
              {lifecycles.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.lifecycle.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-status">
              {t('contacts.form.leadStatus')}
            </label>
            <select id="cf-status" name="leadStatus" className="select" defaultValue="new">
              {leadStatuses.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.leadStatus.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="cf-source">
              {t('contacts.form.source')}
            </label>
            <select id="cf-source" name="source" className="select" defaultValue="">
              <option value="">—</option>
              {sources.map((v) => (
                <option key={v} value={v}>
                  {t(`enums.source.${v}`)}
                </option>
              ))}
            </select>
          </div>
          {customFields.map((f) => (
            <CustomFieldInput key={f.name} field={f} idPrefix="cf" />
          ))}
        </div>
      </AdvancedSection>
    </FormSection>
  );
}
