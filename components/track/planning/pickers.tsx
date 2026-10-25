'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { addDays, toIsoDay } from '@/lib/track-tasks';
import { parseDueQuery } from '../trackCommands';
import KeyPicker, { type KeyPickerOption } from '../KeyPicker';
import { fmtDay } from './shared';

function nextWeekday(today: string, weekday: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  const delta = (weekday - d.getUTCDay() + 7) % 7 || 7;
  return addDays(today, delta);
}

function endOfMonth(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function endOfQuarter(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)).toISOString().slice(0, 10);
}

/**
 * Chip de fecha como los de Linear: atajos (hoy, la semana que viene, fin de
 * mes, fin de trimestre…) y lo que se tipea (2026-12-15, 15/12, +10, 10d),
 * con flechas y Enter. Sin el input nativo mm/dd/yyyy.
 */
export function DateChip({
  value,
  onChange,
  label,
  emptyLabel,
  locale,
  icon,
  testId,
  className,
}: {
  value: string | null;
  onChange: (day: string | null) => void;
  label: string;
  emptyLabel: string;
  locale: string;
  icon?: ReactNode;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations('trackPlanning.pickers');
  const today = toIsoDay(new Date());
  const options = useMemo<KeyPickerOption[]>(() => {
    const opt = (day: string, name: string): KeyPickerOption => ({ value: day, label: name, meta: fmtDay(day, locale, true) });
    return [
      opt(today, t('today')),
      opt(addDays(today, 1), t('tomorrow')),
      opt(nextWeekday(today, 1), t('nextWeek')),
      opt(addDays(today, 14), t('inTwoWeeks')),
      opt(endOfMonth(today), t('endOfMonth')),
      opt(endOfQuarter(today), t('endOfQuarter')),
      ...(value ? [{ value: '', label: t('clear') }] : []),
    ];
  }, [today, locale, t, value]);
  const day = value ? value.slice(0, 10) : null;
  return (
    <KeyPicker
      ariaLabel={label}
      placeholder={t('datePlaceholder')}
      className={`tp-chip${day ? '' : ' is-empty'}${className ? ` ${className}` : ''}`}
      testId={testId}
      value={day ?? ''}
      options={options}
      dynamic={(q) => {
        const iso = parseDueQuery(q, today);
        return iso ? [{ value: iso, label: fmtDay(iso, locale, true), meta: t('typed') }] : [];
      }}
      onSelect={(v) => onChange(v || null)}
      trigger={
        <>
          {icon}
          <span className="track-inline-text">{day ? fmtDay(day, locale) : emptyLabel}</span>
        </>
      }
    />
  );
}
