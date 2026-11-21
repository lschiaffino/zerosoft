'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import CreateFormFields, { missingFromResponse, useCreateForm, useMissingMessage } from './CreateFormFields';
import { createFormBody } from './formPayload';
import { configuredFields, isRequired, missingRequired } from '@/lib/crm-create-form-shared';

interface CompanyQuickCreateProps {
  contactId: string;
}

/**
 * Crea una company desde el detalle de contacto (nombre, dominio y las
 * propiedades del formulario de alta del workspace) y la asocia al contacto:
 * POST /api/crm/companies → PATCH /api/crm/contacts/[id].
 */
export default function CompanyQuickCreate({ contactId }: CompanyQuickCreateProps) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        {t('record.createCompany')}
      </button>
    );
  }
  return <CompanyQuickCreateForm contactId={contactId} onClose={() => setOpen(false)} />;
}

function CompanyQuickCreateForm({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const form = useCreateForm('companies');
  const missingMessage = useMissingMessage('companies');
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = form ? configuredFields('companies', form.fields) : [];
  const domainRequired = form ? isRequired('companies', form.fields, 'domain') : false;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setError(null);
    const body: Record<string, unknown> = {
      ...(formRef.current ? createFormBody('companies', new FormData(formRef.current), configured) : {}),
      name: name.trim(),
      domain: domain.trim() || undefined,
    };
    const missing = form ? missingRequired('companies', form.fields, body) : [];
    if (missing.length) {
      setError(missingMessage(missing, form?.fields));
      return;
    }
    setBusy(true);
    const res = await fetch('/api/crm/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, createForm: true }),
    }).catch(() => null);
    if (!res || res.status !== 201) {
      setBusy(false);
      const data = res ? await res.json().catch(() => null) : null;
      const missingServer = missingFromResponse(data);
      setError(missingServer ? missingMessage(missingServer.fields, form?.fields, missingServer.labels) : t('assoc.failed'));
      return;
    }
    const company = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!company?.id) {
      setBusy(false);
      setError(t('assoc.failed'));
      return;
    }
    const patch = await fetch(`/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: company.id }),
    }).catch(() => null);
    setBusy(false);
    if (!patch || !patch.ok) {
      setError(t('assoc.failed'));
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <form ref={formRef} className="assoc-panel" onSubmit={create} data-testid="company-quick-create">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('companies.form.name')}
        aria-label={t('companies.form.name')}
        maxLength={500}
        required
        autoFocus
      />
      <input
        className="input"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder={t('companies.form.domain')}
        aria-label={t('companies.form.domain')}
        maxLength={500}
        required={domainRequired || undefined}
      />
      {form && (
        <CreateFormFields
          entity="companies"
          fields={configured}
          variant="full"
          idPrefix={`cq-${contactId}`}
          ctx={{ people: form.people, me: form.me }}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={!name.trim() || busy}>
          {busy ? t('common.creating') : t('common.create')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
