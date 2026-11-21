'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { createFormBody } from './formPayload';
import EmailTakenNotice, { emailTakenFrom, type EmailTakenExisting } from './EmailTakenNotice';
import CreateFormFields, { missingFromResponse, useMissingMessage, useMoreHint, type CreateFormOption } from './CreateFormFields';
import { configuredFields, isRequired, missingRequired, type ResolvedCreateField } from '@/lib/crm-create-form-shared';

export type { CustomFieldDef } from './formPayload';

interface ContactFormProps {
  companies: Array<{ id: string; name: string }>;
  /** Formulario de alta configurado (lib/crm-create-form.ts) y el resto de lo editable. */
  form: ResolvedCreateField[];
  more: ResolvedCreateField[];
  people: CreateFormOption[];
  me: string;
  /** Company preseleccionada (p.ej. ?companyId= desde el detalle de company). */
  defaultCompanyId?: string;
}

const ERROR_CODES = [
  'invalid_email',
  'missing_name',
  'invalid_input',
  'invalid_company',
  'invalid_owner',
  'field_readonly',
  'value_taken',
] as const;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/**
 * Alta de contacto. Nombre, apellido y email arriba; después las propiedades
 * que el workspace eligió para el alta (Ajustes › Datos), con las
 * obligatorias marcadas; el resto en "Más campos". Un solo botón: Crear contacto.
 */
export default function ContactForm({ companies, form, more, people, me, defaultCompanyId }: ContactFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const missingMessage = useMissingMessage('contacts');
  /** Ya hay un contacto con ese email (undefined = sin aviso). */
  const [taken, setTaken] = useState<EmailTakenExisting | undefined>(undefined);
  const configured = configuredFields('contacts', form);
  const moreHint = useMoreHint('contacts', more);
  const ctx = {
    companies: companies.map((c) => ({ value: c.id, label: c.name })),
    people,
    me,
    defaultCompanyId,
  };
  const req = (key: string) => (isRequired('contacts', form, key) ? { required: true, 'aria-required': true as const } : {});
  const star = (key: string) =>
    isRequired('contacts', form, key) ? (
      <span className="crm-req" aria-hidden="true">
        {' '}
        *
      </span>
    ) : null;

  async function onSubmit(fd: FormData) {
    setTaken(undefined);
    const body: Record<string, unknown> = {
      ...createFormBody('contacts', fd, [...configured, ...more]),
      firstName: str(fd, 'firstName'),
      lastName: str(fd, 'lastName'),
      email: str(fd, 'email'),
    };
    const missing = missingRequired('contacts', form, body);
    if (missing.length) return missingMessage(missing, form);
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
    // El aviso con el contacto existente va junto al campo; el pie lo resume.
    const existing = emailTakenFrom(data);
    if (existing !== undefined) {
      setTaken(existing);
      return t('errors.contact_email_taken');
    }
    const missingServer = missingFromResponse(data);
    if (missingServer) return missingMessage(missingServer.fields, form, missingServer.labels);
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
            {star('firstName')}
          </label>
          <input id="cf-first" name="firstName" className="input" autoComplete="given-name" autoFocus {...req('firstName')} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="cf-last">
            {t('contacts.form.lastName')}
            {star('lastName')}
          </label>
          <input id="cf-last" name="lastName" className="input" autoComplete="family-name" {...req('lastName')} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="cf-email">
            {t('contacts.form.email')}
            {star('email')}
          </label>
          <input
            id="cf-email"
            name="email"
            className="input"
            type="email"
            autoComplete="email"
            spellCheck={false}
            aria-invalid={taken !== undefined || undefined}
            onChange={() => setTaken(undefined)}
            {...req('email')}
          />
          {taken !== undefined && <EmailTakenNotice existing={taken} />}
        </div>
        <CreateFormFields entity="contacts" fields={configured} variant="full" idPrefix="cf" ctx={ctx} />
      </div>

      {more.length > 0 && (
        <AdvancedSection storageKey="crm.contact.new" label={t('record.form.moreFields')} hint={moreHint}>
          <div className="ui-fields-2">
            <CreateFormFields entity="contacts" fields={more} variant="full" idPrefix="cf" ctx={ctx} />
          </div>
        </AdvancedSection>
      )}
    </FormSection>
  );
}
