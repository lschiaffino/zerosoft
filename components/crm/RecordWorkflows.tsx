'use client';

import LocalText from '@/components/ui/LocalText';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { RecordEnrollment } from '@/lib/crm-workflows';
import { parseDbUtc } from '@/lib/utils';

const TONE: Record<string, string> = { done: 'badge-ok', failed: 'badge-bad', running: 'badge-info', waiting: 'badge-info', pending: '' };

/**
 * Historial de inscripciones del registro en workflows (como "Workflows" en
 * la ficha de HubSpot): nombre del workflow, estado y fecha. La ficha ya
 * comprobó que la persona ve el registro; acá no sale la salida de las acciones.
 */
export default function RecordWorkflows({ enrollments }: { enrollments: RecordEnrollment[] }) {
  const t = useTranslations('crm.workflows');
  const locale = useLocale();
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!enrollments.length) return <p className="ui-help">{t('recordCard.empty')}</p>;
  return (
    <ul className="crm-record-workflows" data-testid="record-workflows">
      {enrollments.map((e) => (
        <li key={e.id} className="crm-record-workflow" data-status={e.status}>
          <Link href={`/app/crm/workflows/${e.workflow_id}`} className="crm-record-workflow-name">
            {e.workflow_name}
          </Link>
          <span className="crm-record-workflow-meta">
            <span className={`badge ${TONE[e.status] ?? ''}`.trim()}>
              {t.has(`runStatus.${e.status}`) ? t(`runStatus.${e.status}` as 'runStatus.done') : e.status}
            </span>
            <LocalText>
              {e.resume_at ? t('recordCard.resumes', { when: fmt.format(parseDbUtc(e.resume_at)) }) : fmt.format(parseDbUtc(e.started_at))}
            </LocalText>
          </span>
        </li>
      ))}
    </ul>
  );
}
