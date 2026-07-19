'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface DealOption {
  id: string;
  name: string;
}

interface AssociateDealProps {
  contactId: string;
  /** Todos los deals del usuario (se filtran con excludeIds). */
  deals: DealOption[];
  excludeIds: string[];
}

/** Asocia un deal existente al contacto: PATCH /api/crm/deals/[id] { addContactIds }. */
export default function AssociateDeal({ contactId, deals, excludeIds }: AssociateDealProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const options = deals.filter((d) => !excludeIds.includes(d.id));

  async function associate() {
    if (!selected || busy) return;
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/deals/${selected}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ addContactIds: [contactId] }),
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
        {t('contacts.detail.associateDeal')}
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
          aria-label={t('contacts.detail.associateDeal')}
        >
          <option value="">{t('assoc.pickDeal')}</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
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
