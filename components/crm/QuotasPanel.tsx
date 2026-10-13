'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import QuotaProgressList, { type QuotaProgressItem } from './QuotaProgressList';

interface Props {
  progress: QuotaProgressItem[];
  people: Array<{ id: string; label: string }>;
  baseCurrency: string;
  locale: string;
  canEdit: boolean;
}

/** Cuotas por owner (mensual/trimestral): progreso del período y alta/edición (admins). */
export default function QuotasPanel({ progress, people, baseCurrency, locale, canEdit }: Props) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [personId, setPersonId] = useState(people[0]?.id ?? '');
  const [metric, setMetric] = useState('won_value');
  const [period, setPeriod] = useState('month');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!personId || !target || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/quotas', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personId, metric, period, target: Number(target) }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setTarget('');
      router.refresh();
    } else setError(t('errors.generic'));
  }

  async function remove(id: string) {
    const res = await fetch(`/api/crm/quotas/${id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) router.refresh();
  }

  return (
    <div className="quota-panel">
      <QuotaProgressList items={progress} baseCurrency={baseCurrency} locale={locale} onDelete={canEdit ? remove : undefined} />
      {canEdit && (
        <div className="score-add-row quota-add">
          <select className="filter-select" value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label={t('quotas.owner')}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select className="filter-select" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label={t('quotas.metric')}>
            {(['won_value', 'won_count', 'meetings'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`quotas.metrics.${m}`)}
              </option>
            ))}
          </select>
          <select className="filter-select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('quotas.period')}>
            {(['month', 'quarter'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`quotas.periods.${p}`)}
              </option>
            ))}
          </select>
          <input
            className="input mono"
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={metric === 'won_value' ? `${t('quotas.target')} (${baseCurrency})` : t('quotas.target')}
            aria-label={t('quotas.target')}
          />
          <button type="button" className="btn btn-solid btn-small" onClick={save} disabled={busy || !target} data-testid="quota-save">
            {t('quotas.save')}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
