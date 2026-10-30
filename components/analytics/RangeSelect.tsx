'use client';

import { useTranslations } from 'next-intl';

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
