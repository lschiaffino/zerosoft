'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

const KNOWN_ERRORS = new Set(['invalid_stage', 'invalid_input', 'missing_name', 'generic']);

interface ContactOption {
  id: string;
  name: string;
}

interface DealFormProps {
  pipelineId: string;
  stageId: string;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  onDone: () => void;
  onCancel: () => void;
}

/** Form inline de nuevo deal dentro de una columna del board (stage preseleccionado). */
export default function DealForm({
  pipelineId,
  stageId,
  priorities,
  sources,
  onDone,
  onCancel,
}: DealFormProps) {
  const t = useTranslations('crm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [closeDate, setCloseDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [source, setSource] = useState('');
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  useEffect(() => {
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
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

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
        ...(contactId ? { contactIds: [contactId] } : {}),
      }),
    }).catch(() => null);
    if (res && res.status === 201) {
      onDone();
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = body?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
    setBusy(false);
  }

  return (
    <form className="kb-deal-form" onSubmit={onSubmit}>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('deals.form.namePlaceholder')}
        aria-label={t('deals.form.name')}
        maxLength={500}
        required
      />
      <div className="kb-deal-form-row">
        <input
          className="input"
          type="number"
          min={0}
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t('deals.form.amount')}
          aria-label={t('deals.form.amount')}
        />
        <input
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          placeholder={t('deals.form.currency')}
          aria-label={t('deals.form.currency')}
          maxLength={3}
        />
      </div>
      <input
        className="input"
        type="date"
        value={closeDate}
        onChange={(e) => setCloseDate(e.target.value)}
        aria-label={t('deals.form.closeDate')}
      />
      <div className="kb-deal-form-row">
        <select
          className="select"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          aria-label={t('deals.form.priority')}
        >
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          aria-label={t('deals.form.source')}
        >
          <option value="">{t('deals.form.source')}</option>
          {sources.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <select
        className="select"
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
        aria-label={t('deals.form.contacts')}
      >
        <option value="">{t('deals.form.contacts')}</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error && <p className="form-error">{error}</p>}
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
