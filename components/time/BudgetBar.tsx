'use client';

import { useTranslations } from 'next-intl';

/** Cuánto se usó del presupuesto en horas: barra y "12 de 40 h". */
export function BudgetBar({ used, budget }: { used: number; budget: number }) {
  const t = useTranslations('time.projects');
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const over = used > budget;
  const hours = (m: number) => (Math.round((m / 60) * 10) / 10).toString();
  return (
    <span className={`tm-budget${over ? ' is-over' : ''}`} data-testid="time-budget">
      <span className="tm-budget-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('used', { used: hours(used), budget: hours(budget) })}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="tm-budget-text num">{over ? t('over') : t('used', { used: hours(used), budget: hours(budget) })}</span>
    </span>
  );
}
