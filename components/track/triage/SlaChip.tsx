'use client';

import { useTranslations } from 'next-intl';
import { slaRemaining, slaState, type SlaState } from '@/lib/track-triage-shared';

/** Ícono de SLA (llama, como Linear): el color sigue al estado. */
function FlameIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5c.3 2.1-1.6 3.2-2.6 4.7C4.4 7.7 4 8.8 4 10a4 4 0 0 0 8 0c0-1.6-.8-2.9-1.6-3.8.1 1-.3 1.9-1 2.3.2-2.5-.4-5.1-1.4-7Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * SLA de un issue: "3d left", "5h overdue" o, cerrado, si se cumplió.
 * Recibe el vencimiento y desde cuándo está en riesgo (de la lista o del detalle).
 */
export default function SlaChip({
  dueAt,
  riskAt,
  completedAt = null,
  compact = false,
}: {
  dueAt: string | null | undefined;
  riskAt: string | null | undefined;
  completedAt?: string | null;
  compact?: boolean;
}) {
  const t = useTranslations('trackTriage.sla');
  if (!dueAt || !riskAt) return null;
  const state: SlaState = slaState({ dueAt, riskAt, completedAt });
  const rem = slaRemaining(dueAt);
  const unit = t(`units.${rem.unit}`);
  const text =
    state === 'met' || state === 'failed'
      ? t(`states.${state}`)
      : rem.overdue
        ? t('overdue', { amount: rem.amount, unit })
        : t('left', { amount: rem.amount, unit });
  const title = `${t('label')}: ${t(`states.${state}`)} · ${t('due', { date: new Date(dueAt).toLocaleString() })}`;
  return (
    <span className={`track-sla is-${state}${compact ? ' is-compact' : ''}`} title={title} data-testid="track-sla-chip" data-state={state}>
      <FlameIcon />
      <span className={compact ? 'track-sla-text' : undefined}>{text}</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}
