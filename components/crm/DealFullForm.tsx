'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

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

/** Form completo de creación de deal (página /app/crm/deals/new). */
export default function DealFullForm({
  pipelines,
  priorities,
  sources,
  fixedContactId,
}: DealFullFormProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [closeDate, setCloseDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const [contactId, setContactId] = useState(fixedContactId ?? '');
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const openStages = (pipeline?.stages ?? []).filter((s) => !s.is_won && !s.is_lost);
  const stages = openStages.length ? openStages : (pipeline?.stages ?? []);
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');

  // Al cambiar de pipeline, el stage vuelve al primero abierto.
  useEffect(() => {
    setStageId(stages[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  useEffect(() => {
    if (fixedContactId) return;
    let cancelled = false;
    fetch('/api/crm/contacts?pageSize=100')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then(
        (data: {
          rows: Array<{ id: string; first_name: string; last_name: string; email: string }>;
        }) => {
          if (cancelled) return;
          setContacts(
            data.rows.map((c) => ({
              id: c.id,
              name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            })),
          );
        },
      )
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [fixedContactId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('errors.missing_name'));
      return;
    }
    setBusy(true);
    const res = await fetch('/api/crm/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pipelineId,
        stageId,
        name: name.trim(),
        amount: amount ? Number(amount) : 0,
        currency: currency.trim().toUpperCase() || 'USD',
        closeDate: closeDate || null,
        priority,
        ...(source ? { source } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(contactId ? { contactIds: [contactId] } : {}),
      }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const deal = (await res.json().catch(() => null)) as { id?: string } | null;
      router.push(deal?.id ? `/app/crm/deals/${deal.id}` : '/app/crm/deals');
      router.refresh();
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
    setBusy(false);
  }

  return (
    <form className="crm-form" onSubmit={onSubmit}>
      <label className="field">
        <span className="prop-label">{t('deals.form.name')}</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('deals.form.namePlaceholder')}
          maxLength={500}
          required
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('deals.form.amount')}</span>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="prop-label">{t('deals.form.currency')}</span>
          <input
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={3}
          />
        </label>
      </div>

      <label className="field">
        <span className="prop-label">{t('deals.form.closeDate')}</span>
        <input
          className="input"
          type="date"
          value={closeDate}
          onChange={(e) => setCloseDate(e.target.value)}
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('deals.pipelineLabel')}</span>
          <select
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
        </label>
        <label className="field">
          <span className="prop-label">{t('deals.form.stage')}</span>
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="prop-label">{t('deals.form.priority')}</span>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {priorities.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="prop-label">{t('deals.form.source')}</span>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">—</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!fixedContactId && (
        <label className="field">
          <span className="prop-label">{t('deals.form.contacts')}</span>
          <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="prop-label">{t('deals.form.description')}</span>
        <textarea
          className="textarea"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
        />
      </label>

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={busy}>
          {busy ? t('common.creating') : t('common.create')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => router.push('/app/crm/deals')}
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
