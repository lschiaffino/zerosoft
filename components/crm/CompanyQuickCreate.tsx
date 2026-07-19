'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface CompanyQuickCreateProps {
  contactId: string;
}

/**
 * Crea una company mínima (nombre + dominio) desde el detalle de contacto
 * y la asocia al contacto: POST /api/crm/companies → PATCH /api/crm/contacts/[id].
 */
export default function CompanyQuickCreate({ contactId }: CompanyQuickCreateProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), domain: domain.trim() || undefined }),
    }).catch(() => null);
    if (!res || res.status !== 201) {
      setBusy(false);
      setError(true);
      return;
    }
    const company = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!company?.id) {
      setBusy(false);
      setError(true);
      return;
    }
    const patch = await fetch(`/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: company.id }),
    }).catch(() => null);
    setBusy(false);
    if (!patch || !patch.ok) {
      setError(true);
      return;
    }
    setOpen(false);
    setName('');
    setDomain('');
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="kb-add" onClick={() => setOpen(true)}>
        {t('contacts.detail.newCompany')}
      </button>
    );
  }

  return (
    <div className="assoc-panel">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('companies.form.name')}
        aria-label={t('companies.form.name')}
        maxLength={500}
      />
      <input
        className="input"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder={t('companies.form.domain')}
        aria-label={t('companies.form.domain')}
        maxLength={500}
      />
      {error && <p className="form-error">{t('assoc.failed')}</p>}
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-solid btn-small"
          disabled={!name.trim() || busy}
          onClick={create}
        >
          {busy ? t('common.creating') : t('common.create')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
