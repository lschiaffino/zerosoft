'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import { creatableStages, dealPayload } from './formPayload';

const KNOWN_ERRORS = new Set(['invalid_stage', 'invalid_input', 'missing_name', 'generic']);

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

interface ContactOption {
  id: string;
  name: string;
}

interface DealFullFormProps {
  pipelines: PipelineOption[];
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  /** Si viene, el deal se crea ya vinculado a este contacto (sin selector). */
  fixedContactId?: string;
}

/**
 * Alta de deal (/app/crm/deals/new). Lo básico: nombre, monto, etapa y
 * contacto. El pipeline aparece solo si hay más de uno. Moneda, cierre,
 * prioridad, origen y descripción van en "Más campos".
 */
export default function DealFullForm({ pipelines, priorities, sources, fixedContactId }: DealFullFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const [currency, setCurrency] = useState('USD');
  const [contacts, setContacts] = useState<ContactOption[] | null>(fixedContactId ? [] : null);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const stages = creatableStages(pipeline);

  useEffect(() => {
    if (fixedContactId) return;
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data: { rows: Array<{ id: string; first_name: string; last_name: string; email: string }> }) => {
        if (cancelled) return;
        setContacts(
          data.rows.map((c) => ({
            id: c.id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fixedContactId]);

  async function onSubmit(fd: FormData) {
    const body = dealPayload(fd, fixedContactId);
    if (!body.name) return t('errors.missing_name');
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
          <label className="label" htmlFor="df-amount">
            {t('deals.form.amount')}
          </label>
          <div className="ui-input-group">
            <input id="df-amount" name="amount" className="input num" type="number" min={0} step="any" inputMode="decimal" />
            <span className="ui-addon data" aria-hidden="true">
              {currency.trim().toUpperCase() || 'USD'}
            </span>
          </div>
        </div>
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
        {!fixedContactId && (
          <div className="ui-field">
            <label className="label" htmlFor="df-contact">
              {t('record.form.contact')}
            </label>
            <select id="df-contact" name="contactId" className="select" defaultValue="" aria-busy={contacts === null || undefined}>
              <option value="">{contacts === null ? t('record.loading') : t('record.form.noContact')}</option>
              {(contacts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <AdvancedSection storageKey="crm.deal.new" label={t('record.form.moreFields')} hint={t('record.form.dealMoreHint')}>
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="df-currency">
              {t('deals.form.currency')}
            </label>
            <input
              id="df-currency"
              name="currency"
              className="input data"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="df-close">
              {t('deals.form.closeDate')}
            </label>
            <input id="df-close" name="closeDate" className="input" type="date" />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="df-priority">
              {t('deals.form.priority')}
            </label>
            <select id="df-priority" name="priority" className="select" defaultValue="medium">
              {priorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="df-source">
              {t('deals.form.source')}
            </label>
            <select id="df-source" name="source" className="select" defaultValue="">
              <option value="">—</option>
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="df-desc">
            {t('deals.form.description')}
          </label>
          <textarea id="df-desc" name="description" className="textarea" rows={3} maxLength={5000} />
        </div>
      </AdvancedSection>
    </FormSection>
  );
}
