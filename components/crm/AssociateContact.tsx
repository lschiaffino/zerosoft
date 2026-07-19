'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface ContactOption {
  id: string;
  name: string;
}

interface AssociateContactProps {
  companyId: string;
  /** Todos los contacts del usuario (se filtran con excludeIds). */
  contacts: ContactOption[];
  excludeIds: string[];
}

/** Asocia un contact existente a la company: PATCH /api/crm/contacts/[id] { companyId }. */
export default function AssociateContact({ companyId, contacts, excludeIds }: AssociateContactProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const options = contacts.filter((c) => !excludeIds.includes(c.id));

  async function associate() {
    if (!selected || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/contacts/${selected}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError(true);
      return;
    }
    setOpen(false);
    setSelected('');
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="kb-add" onClick={() => setOpen(true)}>
        {t('companies.detail.associateContact')}
      </button>
    );
  }

  return (
    <div className="assoc-panel">
      {options.length === 0 ? (
        <p className="muted">{t('assoc.noOptions')}</p>
      ) : (
        <select
          className="select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={t('companies.detail.associateContact')}
        >
          <option value="">{t('assoc.pickContact')}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {error && <p className="form-error">{t('assoc.failed')}</p>}
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-solid btn-small"
          disabled={!selected || busy}
          onClick={associate}
        >
          {busy ? t('assoc.associating') : t('assoc.associate')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
