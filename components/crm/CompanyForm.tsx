'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/** Códigos de error de la API que tienen traducción en crm.errors.*. */
const KNOWN_ERRORS = new Set([
  'invalid_email',
  'missing_name',
  'not_found',
  'invalid_input',
  'generic',
]);

interface CompanyFormProps {
  lifecycles: Array<{ value: string; label: string }>;
}

export default function CompanyForm({ lifecycles }: CompanyFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [industry, setIndustry] = useState('');
  const [employees, setEmployees] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState('lead');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('errors.missing_name'));
      return;
    }
    setBusy(true);
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        domain: domain.trim(),
        industry: industry.trim(),
        employees: employees ? Number(employees) : null,
        phone: phone.trim(),
        website: website.trim(),
        city: city.trim(),
        country: country.trim(),
        lifecycleStage,
      }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const created = (await res.json()) as { id: string };
      router.push(`/app/crm/companies/${created.id}`);
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
    setBusy(false);
  }

  return (
    <form className="crm-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('companies.form.name')}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={500}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('companies.form.domain')}</span>
          <input
            className="input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="acme.com"
            maxLength={500}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('companies.form.industry')}</span>
          <input
            className="input"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('companies.form.employees')}</span>
          <input
            className="input"
            type="number"
            min={0}
            value={employees}
            onChange={(e) => setEmployees(e.target.value)}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('companies.form.phone')}</span>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('companies.form.website')}</span>
          <input
            className="input"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            maxLength={500}
          />
        </label>
      </div>

      <div className="form-grid form-grid-3">
        <label className="field">
          <span className="prop-label">{t('companies.form.city')}</span>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={500} />
        </label>
        <label className="field">
          <span className="prop-label">{t('companies.form.country')}</span>
          <input
            className="input"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={500}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('companies.form.lifecycle')}</span>
          <select
            className="select"
            value={lifecycleStage}
            onChange={(e) => setLifecycleStage(e.target.value)}
          >
            {lifecycles.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
          {busy ? t('common.creating') : t('common.create')}
        </button>
      </div>
    </form>
  );
}
