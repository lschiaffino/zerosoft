'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';

interface ContactChip {
  id: string;
  name: string;
  email: string;
}

interface DealContactsProps {
  dealId: string;
  contacts: ContactChip[];
}

/** Chips de contactos asociados al deal: quitar/agregar vía PATCH contactIds. */
export default function DealContacts({ dealId, contacts }: DealContactsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ContactChip[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
        if (cancelled) return;
        setOptions(
          data.rows.map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            email: c.email,
          })),
        );
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  async function patch(contactIds: string[]) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/crm/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactIds }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError(true);
      return;
    }
    router.refresh();
  }

  const currentIds = contacts.map((c) => c.id);
  const addable = options.filter((o) => !currentIds.includes(o.id));

  return (
    <div className="deal-contacts">
      {contacts.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <div className="chip-list">
          {contacts.map((c) => (
            <span className="chip-contact" key={c.id}>
              <Link href={`/app/crm/contacts/${c.id}`}>{c.name}</Link>
              <button
                type="button"
                className="chip-remove"
                aria-label={`${t('common.delete')} ${c.name}`}
                disabled={busy}
                onClick={() => patch(currentIds.filter((id) => id !== c.id))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        className="filter-select"
        value=""
        disabled={busy || addable.length === 0}
        aria-label={t('deals.form.contacts')}
        onChange={(e) => {
          const id = e.target.value;
          e.target.value = '';
          if (id) void patch([...currentIds, id]);
        }}
      >
        <option value="">{t('common.add')}…</option>
        {addable.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <p className="form-error">{t('errors.generic')}</p>}
    </div>
  );
}
