'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import CreateFormFields, { missingFromResponse, useCreateForm, useMissingMessage, type CreateFormOption } from './CreateFormFields';
import { createFormBody } from './formPayload';
import { configuredFields, missingRequired } from '@/lib/crm-create-form-shared';

const KNOWN_ERRORS = new Set([
  'invalid_stage',
  'invalid_input',
  'missing_name',
  'invalid_contact',
  'invalid_owner',
  'field_readonly',
  'value_taken',
  'generic',
]);

interface DealFormProps {
  pipelineId: string;
  stageId: string;
  /** Si viene, el deal se crea ya vinculado a este contacto (sin selector). */
  fixedContactId?: string;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Form inline de nuevo deal dentro de una columna del board o del detalle de
 * contacto (etapa preseleccionada): el nombre y las propiedades del
 * formulario de alta del workspace (Ajustes › Datos).
 */
export default function DealForm({ pipelineId, stageId, fixedContactId, onDone, onCancel }: DealFormProps) {
  const t = useTranslations('crm');
  const form = useCreateForm('deals');
  const missingMessage = useMissingMessage('deals');
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState<CreateFormOption[] | null>(null);

  const configured = form
    ? configuredFields('deals', form.fields).filter((f) => !(fixedContactId && f.key === 'contactId'))
    : [];
  const needsContacts = configured.some((f) => f.key === 'contactId');

  useEffect(() => {
    if (!needsContacts) return;
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
        if (cancelled) return;
        setContacts(data.rows.map((c) => ({ value: c.id, label: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email })));
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsContacts]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('errors.missing_name'));
      return;
    }
    const body: Record<string, unknown> = {
      ...(formRef.current ? createFormBody('deals', new FormData(formRef.current), configured) : {}),
      pipelineId,
      stageId,
      name: name.trim(),
      ...(fixedContactId ? { contactIds: [fixedContactId] } : {}),
    };
    const missing = form ? missingRequired('deals', form.fields, body) : [];
    if (missing.length) {
      setError(missingMessage(missing, form?.fields));
      return;
    }
    setBusy(true);
    const res = await fetch('/api/crm/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.status === 201) {
      onDone();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    const missingServer = missingFromResponse(data);
    setError(
      missingServer
        ? missingMessage(missingServer.fields, form?.fields, missingServer.labels)
        : t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'),
    );
    setBusy(false);
  }

  return (
    <form ref={formRef} className="kb-deal-form" onSubmit={onSubmit} data-testid="deal-inline-form">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('deals.form.namePlaceholder')}
        aria-label={t('deals.form.name')}
        maxLength={500}
        required
        autoFocus
      />
      {form && (
        <CreateFormFields
          entity="deals"
          fields={configured}
          variant="full"
          idPrefix={`kb-${stageId}`}
          ctx={{ contacts, people: form.people, me: form.me, baseCurrency: form.baseCurrency }}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
          {busy ? t('common.creating') : t('common.create')}
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
