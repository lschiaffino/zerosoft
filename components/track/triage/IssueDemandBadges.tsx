'use client';

import { useTranslations } from 'next-intl';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import SlaChip from './SlaChip';

/** En la fila de la lista: SLA abierto y cuántos clientes pidieron el issue. */
export default function IssueDemandBadges({
  issue,
}: {
  issue: Pick<TrackIssueWithStatus, 'sla_due_at' | 'sla_risk_at' | 'customer_count'>;
}) {
  const t = useTranslations('trackTriage');
  const customers = issue.customer_count ?? 0;
  if (!issue.sla_due_at && customers === 0) return null;
  return (
    <>
      {issue.sla_due_at && <SlaChip dueAt={issue.sla_due_at} riskAt={issue.sla_risk_at} compact />}
      {customers > 0 && (
        <span className="track-demand" title={t('queue.customers', { count: customers })} data-testid="track-customer-count">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <circle cx="6" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 13.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M11 3.2a2.4 2.4 0 0 1 0 4.6M12.6 10.2c1 .6 1.6 1.7 1.9 3.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="sr-only">{t('queue.customers', { count: customers })}</span>
          <span aria-hidden="true">{customers}</span>
        </span>
      )}
    </>
  );
}
