'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface CustomFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options: string[];
}

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

/** Form de alta de contacto: campos estándar + empresa + custom fields por tipo. */
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
  const [values, setValues] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    website: '',
    city: '',
    country: '',
    lifecycleStage: 'lead',
    leadStatus: 'new',
    source: '',
    companyId: defaultCompanyId ?? '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof typeof values) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [key]: e.target.value }));
  }

  function setCustomValue(name: string, value: unknown) {
    setCustom((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        jobTitle: values.jobTitle || undefined,
        website: values.website || undefined,
        city: values.city || undefined,
        country: values.country || undefined,
        lifecycleStage: values.lifecycleStage,
        leadStatus: values.leadStatus,
        source: values.source || undefined,
        companyId: values.companyId || null,
        custom,
      }),
    }).catch(() => null);

    if (res && res.status === 201) {
      const contact = (await res.json()) as { id: string };
      router.push(`/app/crm/contacts/${contact.id}`);
      return;
    }

    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(
      (ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : t('errors.generic'),
    );
    setBusy(false);
  }

  return (
    <form className="crm-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('contacts.form.firstName')}</span>
          <input className="input" value={values.firstName} onChange={set('firstName')} />
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.lastName')}</span>
          <input className="input" value={values.lastName} onChange={set('lastName')} />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('contacts.form.email')}</span>
          <input className="input" type="email" value={values.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.phone')}</span>
          <input className="input" value={values.phone} onChange={set('phone')} />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('contacts.form.jobTitle')}</span>
          <input className="input" value={values.jobTitle} onChange={set('jobTitle')} />
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.website')}</span>
          <input className="input" value={values.website} onChange={set('website')} />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('contacts.form.city')}</span>
          <input className="input" value={values.city} onChange={set('city')} />
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.country')}</span>
          <input className="input" value={values.country} onChange={set('country')} />
        </label>
      </div>

      <div className="form-grid form-grid-3">
        <label className="field">
          <span className="prop-label">{t('contacts.form.lifecycle')}</span>
          <select className="select" value={values.lifecycleStage} onChange={set('lifecycleStage')}>
            {lifecycles.map((v) => (
              <option key={v} value={v}>
                {t(`enums.lifecycle.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.leadStatus')}</span>
          <select className="select" value={values.leadStatus} onChange={set('leadStatus')}>
            {leadStatuses.map((v) => (
              <option key={v} value={v}>
                {t(`enums.leadStatus.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="prop-label">{t('contacts.form.source')}</span>
          <select className="select" value={values.source} onChange={set('source')}>
            <option value="">—</option>
            {sources.map((v) => (
              <option key={v} value={v}>
                {t(`enums.source.${v}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="prop-label">{t('contacts.form.company')}</span>
        <select className="select" value={values.companyId} onChange={set('companyId')}>
          <option value="">{t('contacts.form.noCompany')}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {customFields.length > 0 && (
        <div className="form-grid">
          {customFields.map((f) => (
            <label key={f.name} className="field">
              <span className="prop-label">{f.label}</span>
              {f.type === 'select' ? (
                <select
                  className="select"
                  value={typeof custom[f.name] === 'string' ? (custom[f.name] as string) : ''}
                  onChange={(e) => setCustomValue(f.name, e.target.value)}
                >
                  <option value="">—</option>
                  {f.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : f.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={custom[f.name] === true}
                  onChange={(e) => setCustomValue(f.name, e.target.checked)}
                />
              ) : f.type === 'number' ? (
                <input
                  className="input"
                  type="number"
                  value={typeof custom[f.name] === 'number' ? String(custom[f.name]) : ''}
                  onChange={(e) =>
                    setCustomValue(f.name, e.target.value === '' ? undefined : Number(e.target.value))
                  }
                />
              ) : f.type === 'date' ? (
                <input
                  className="input"
                  type="date"
                  value={typeof custom[f.name] === 'string' ? (custom[f.name] as string) : ''}
                  onChange={(e) => setCustomValue(f.name, e.target.value)}
                />
              ) : (
                <input
                  className="input"
                  value={typeof custom[f.name] === 'string' ? (custom[f.name] as string) : ''}
                  onChange={(e) => setCustomValue(f.name, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-solid" disabled={busy}>
          {busy ? t('common.creating') : t('common.create')}
        </button>
      </div>
    </form>
  );
}
