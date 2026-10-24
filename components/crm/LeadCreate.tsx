'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import RecordCombobox, { type ComboOption } from './RecordCombobox';

/** Contactos que no entraron en la lista precargada: busca en el servidor. */
async function searchContacts(q: string): Promise<ComboOption[]> {
  const res = await fetch(`/api/crm/contacts?q=${encodeURIComponent(q)}&pageSize=20`);
  if (!res.ok) return [];
  const data = (await res.json()) as { rows: Array<{ id: string; first_name?: string; last_name?: string; email?: string }> };
  return data.rows.map((c) => ({ value: c.id, label: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '' }));
}

interface Option {
  value: string;
  label: string;
}

interface LeadCreateProps {
  contacts: Option[];
  companies: Option[];
  owners: Option[];
  stages: Option[];
  sources: Option[];
  defaultOwner: string;
  /** Contacto o empresa fijos (desde su ficha). */
  fixedContactId?: string;
  fixedCompanyId?: string;
  /** primary: CTA del header con atajo C y ?new=1; secondary: botón de una ficha o del vacío. */
  variant?: 'primary' | 'secondary' | 'empty';
  label?: string;
}

/** Alta de un lead en un modal: nombre (o el del contacto), contacto, empresa, owner, etapa y fuente. */
export default function LeadCreate({
  contacts,
  companies,
  owners,
  stages,
  sources,
  defaultOwner,
  fixedContactId,
  fixedCompanyId,
  variant = 'primary',
  label,
}: LeadCreateProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const primary = variant === 'primary';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactId, setContactId] = useState(fixedContactId ?? '');
  const [companyId, setCompanyId] = useState(fixedCompanyId ?? '');
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [stageId, setStageId] = useState(stages[0]?.value ?? '');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useKeyShortcut('c', () => setOpen(true), primary && !open);

  useEffect(() => {
    if (!primary || searchParams.get('new') !== '1') return;
    setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('new');
    router.replace(params.size ? `${pathname}?${params}` : pathname);
  }, [primary, searchParams, pathname, router]);

  const canSubmit = !!(name.trim() || contactId || companyId);

  function close() {
    setOpen(false);
    setName('');
    setError(null);
    if (!fixedContactId) setContactId('');
    if (!fixedCompanyId) setCompanyId('');
  }

  async function submit() {
    if (!canSubmit || busy) {
      if (!canSubmit) setError(t('leads.form.needOne'));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim() || undefined,
        contactId: contactId || null,
        companyId: companyId || null,
        ownerId: ownerId || null,
        stageId: stageId || undefined,
        source: source || undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const created = (await res.json()) as { id: string };
      close();
      router.push(`/app/crm/leads/${created.id}`);
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  const buttonLabel = label ?? t('leads.newCta');
  return (
    <>
      <button
        type="button"
        className={primary ? 'btn btn-primary btn-sm' : variant === 'empty' ? 'btn btn-primary' : 'btn btn-secondary btn-sm'}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
        {primary && (
          <kbd className="kbd" aria-hidden>
            C
          </kbd>
        )}
      </button>
      <QuickModal
        open={open}
        onClose={close}
        title={t('leads.newTitle')}
        onSubmit={submit}
        submitLabel={busy ? t('common.creating') : t('common.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!canSubmit}
        busy={busy}
        error={error}
      >
        <input
          data-autofocus
          className="qm-title"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('leads.form.namePlaceholder')}
          aria-label={t('leads.form.name')}
          maxLength={200}
        />
        <div className="qm-row">
          <div className="qm-field">
            <span>{t('leads.form.contact')}</span>
            <RecordCombobox
              options={contacts}
              value={contactId}
              onChange={setContactId}
              disabled={!!fixedContactId}
              noneLabel={t('leads.form.noContact')}
              placeholder={t('leads.form.searchContact')}
              ariaLabel={t('leads.form.contact')}
              search={searchContacts}
            />
          </div>
          <label className="qm-field">
            <span>{t('leads.form.company')}</span>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={!!fixedCompanyId}>
              <option value="">{t('leads.form.noCompany')}</option>
              {companies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('leads.form.owner')}</span>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {owners.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="qm-field">
            <span>{t('leads.form.stage')}</span>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              {stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="qm-field">
          <span>{t('leads.form.source')}</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('leads.form.noSource')}</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </QuickModal>
    </>
  );
}
