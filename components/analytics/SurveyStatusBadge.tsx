'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { SurveyDisplayStatus } from '@/lib/analytics/surveys-core';

const CLASS: Record<SurveyDisplayStatus, string> = {
  draft: 'badge badge-outline',
  running: 'badge badge-ok',
  scheduled: 'badge badge-info',
  paused: 'badge badge-warn',
  ended: 'badge',
};

export function SurveyStatusBadge({ status }: { status: SurveyDisplayStatus }) {
  const t = useTranslations('analyticsMore.surveys.status');
  return <span className={CLASS[status]}>{t(status)}</span>;
}

/** Pestañas de una encuesta: editar y resultados. */
export function SurveyTabs({ id, current }: { id: string; current: 'edit' | 'results' }) {
  const t = useTranslations('analyticsMore.surveys');
  return (
    <nav className="ui-tabs" aria-label={t('tabsLabel')}>
      <Link href={`/app/pulse/surveys/${id}`} className="ui-tab" aria-current={current === 'edit' ? 'page' : undefined}>
        {t('tabEdit')}
      </Link>
      <Link href={`/app/pulse/surveys/${id}/results`} className="ui-tab" aria-current={current === 'results' ? 'page' : undefined}>
        {t('tabResults')}
      </Link>
    </nav>
  );
}
