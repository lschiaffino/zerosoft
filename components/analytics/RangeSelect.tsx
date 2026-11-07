'use client';

import { useTranslations } from 'next-intl';
import type { DateRange } from '@/lib/analytics/types';

export const RANGES = ['-24h', '-7d', '-14d', '-30d', '-90d', '-180d', '-365d'] as const;

/** Rango de fechas relativo (últimas 24 h, 7 días…). */
export default function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('analytics.ranges');
  return (
    <select className="select an-range" aria-label={t('label')} value={value} onChange={(e) => onChange(e.target.value)}>
      {RANGES.map((r) => (
        <option key={r} value={r}>
          {t(r.slice(1))}
        </option>
      ))}
    </select>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Rango relativo o con fechas: al elegir "Personalizado" aparecen desde y
 * hasta. Si una fecha queda vacía o invertida se conserva la última válida.
 */
export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const t = useTranslations('analytics.ranges');
  const custom = /^\d{4}-/.test(value.from);
  return (
    <div className="an-row an-wrap">
      <select
        className="select an-range"
        aria-label={t('label')}
        value={custom ? 'custom' : RANGES.includes(value.from as (typeof RANGES)[number]) ? value.from : 'custom'}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            const d = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
            onChange({ from: d, to: today() });
          } else onChange({ from: e.target.value });
        }}
      >
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {t(r.slice(1))}
          </option>
        ))}
        <option value="custom">{t('custom')}</option>
      </select>
      {custom && (
        <>
          <input
            className="input an-date-input"
            type="date"
            aria-label={t('from')}
            value={value.from}
            max={value.to ?? undefined}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
          <input
            className="input an-date-input"
            type="date"
            aria-label={t('to')}
            value={value.to ?? today()}
            min={value.from}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}
