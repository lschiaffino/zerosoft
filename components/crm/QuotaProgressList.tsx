'use client';

import { useTranslations } from 'next-intl';

export interface QuotaProgressItem {
  id: string;
  personName: string;
  metric: 'won_value' | 'won_count' | 'meetings';
  period: 'month' | 'quarter';
  periodLabel: string;
  target: number;
  actual: number;
  pct: number;
  expectedPct: number;
  onTrack: boolean;
}

interface Props {
  items: QuotaProgressItem[];
  baseCurrency: string;
  locale: string;
  onDelete?: (id: string) => void;
  compact?: boolean;
}

/** Barras de progreso de cuotas (hairline + marca del ritmo esperado). */
export default function QuotaProgressList({ items, baseCurrency, locale, onDelete, compact }: Props) {
  const t = useTranslations('crm');
  const fmt = (metric: QuotaProgressItem['metric'], n: number) =>
    metric === 'won_value'
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, maximumFractionDigits: 0 }).format(n)
      : new Intl.NumberFormat(locale).format(n);

  if (!items.length) return <p className="muted">{t('quotas.empty')}</p>;
  return (
    <ul className={`quota-list${compact ? ' compact' : ''}`}>
      {items.map((q) => (
        <li key={q.id} className="quota-item" data-testid="quota-item">
          <div className="quota-line">
            <span className="quota-who">
              {q.personName}
              <span className="muted"> · {t(`quotas.metrics.${q.metric}`)} · {q.periodLabel}</span>
            </span>
            <span className="mono quota-nums">
              {fmt(q.metric, q.actual)} / {fmt(q.metric, q.target)}
              <span className={q.onTrack ? 'quota-ok' : 'quota-behind'}> · {q.pct}%</span>
            </span>
            {onDelete && (
              <button type="button" className="icon-btn danger" onClick={() => onDelete(q.id)} aria-label={t('common.delete')}>
                ✕
              </button>
            )}
          </div>
          <div className="quota-bar" role="progressbar" aria-valuenow={Math.round(q.pct)} aria-valuemin={0} aria-valuemax={100}>
            <span className={`quota-fill${q.onTrack ? '' : ' behind'}`} style={{ width: `${Math.min(100, q.pct)}%` }} />
            <span className="quota-mark" style={{ left: `${Math.min(100, q.expectedPct)}%` }} title={t('quotas.expected', { pct: q.expectedPct })} />
          </div>
        </li>
      ))}
    </ul>
  );
}
