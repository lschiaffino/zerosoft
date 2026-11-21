'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { createFormBody, creatableStages } from './formPayload';
import CreateFormFields, { missingFromResponse, useMissingMessage, useMoreHint, type CreateFormOption } from './CreateFormFields';
import { configuredFields, missingRequired, type ResolvedCreateField } from '@/lib/crm-create-form-shared';

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

interface StageOption {
  id: string;
  name: string;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

interface PipelineOption {
  id: string;
  name: string;
  stages: StageOption[];
}

interface DealFullFormProps {
  pipelines: PipelineOption[];
  /** Formulario de alta configurado (lib/crm-create-form.ts) y el resto de lo editable. */
  form: ResolvedCreateField[];
  more: ResolvedCreateField[];
  people: CreateFormOption[];
  me: string;
  baseCurrency: string;
  /** Si viene, el deal se crea ya vinculado a este contacto (sin selector). */
  fixedContactId?: string;
}

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/**
 * Alta de deal (/app/crm/deals/new). Nombre y etapa arriba (el pipeline solo
 * si hay más de uno); después las propiedades que el workspace eligió para el
 * alta (Ajustes › Datos) y el resto en "Más campos".
 */
export default function DealFullForm({ pipelines, form, more, people, me, baseCurrency, fixedContactId }: DealFullFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const missingMessage = useMissingMessage('deals');
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  // Con contacto fijo no se ofrece el selector.
  const visible = (list: ResolvedCreateField[]) => (fixedContactId ? list.filter((f) => f.key !== 'contactId') : list);
  const configured = visible(configuredFields('deals', form));
  const rest = visible(more);
  const moreHint = useMoreHint('deals', rest);
  const needsContacts = !fixedContactId && [...configured, ...rest].some((f) => f.key === 'contactId');
  const [contacts, setContacts] = useState<CreateFormOption[] | null>(null);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const stages = creatableStages(pipeline);

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

  const ctx = { contacts, people, me, baseCurrency };

  async function onSubmit(fd: FormData) {
    const body: Record<string, unknown> = {
      ...createFormBody('deals', fd, [...configured, ...rest]),
      pipelineId: str(fd, 'pipelineId') ?? '',
      stageId: str(fd, 'stageId') ?? '',
      name: str(fd, 'name') ?? '',
      ...(fixedContactId ? { contactIds: [fixedContactId] } : {}),
    };
    if (!body.name) return t('errors.missing_name');
    const missing = missingRequired('deals', form, body);
    if (missing.length) return missingMessage(missing, form);
    const res = await fetch('/api/crm/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res && res.status === 201) {
      const deal = (await res.json().catch(() => null)) as { id?: string } | null;
      router.push(deal?.id ? `/app/crm/deals/${deal.id}` : '/app/crm/deals');
      router.refresh();
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    const missingServer = missingFromResponse(data);
    if (missingServer) return missingMessage(missingServer.fields, form, missingServer.labels);
    return t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic');
  }

  return (
    <FormSection
      title={t('record.form.dealTitle')}
      description={t('record.form.dealDesc')}
      submitLabel={t('record.createDeal')}
      onSubmit={onSubmit}
    >
      <div className="ui-field">
        <label className="label" htmlFor="df-name">
          {t('deals.form.name')}
          <span className="crm-req" aria-hidden="true">
            {' '}
            *
          </span>
        </label>
        <input
          id="df-name"
          name="name"
          className="input"
          placeholder={t('deals.form.namePlaceholder')}
          maxLength={500}
          required
          autoFocus
        />
      </div>

      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="df-stage">
            {t('deals.form.stage')}
          </label>
          <select id="df-stage" name="stageId" className="select" key={pipeline?.id} defaultValue={stages[0]?.id}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {pipelines.length > 1 ? (
          <div className="ui-field">
            <label className="label" htmlFor="df-pipeline">
              {t('deals.pipelineLabel')}
            </label>
            <select
              id="df-pipeline"
              name="pipelineId"
              className="select"
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="pipelineId" value={pipeline?.id ?? ''} />
        )}
        <CreateFormFields entity="deals" fields={configured} variant="full" idPrefix="df" ctx={ctx} />
      </div>

      {rest.length > 0 && (
        <AdvancedSection storageKey="crm.deal.new" label={t('record.form.moreFields')} hint={moreHint}>
          <div className="ui-fields-2">
            <CreateFormFields entity="deals" fields={rest} variant="full" idPrefix="df" ctx={ctx} />
          </div>
        </AdvancedSection>
      )}
    </FormSection>
  );
}
