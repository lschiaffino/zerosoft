import { getTranslations } from 'next-intl/server';
import { ACTIVITY_DATE_COLUMNS, ACTIVITY_DATE_FIELDS, formatActivityDate } from '@/lib/crm-activity-dates';

interface ActivityDateFactsProps {
  record: { last_activity_at?: string | null; last_contacted_at?: string | null; next_activity_at?: string | null };
  locale: string;
}

/** Filas del resumen de un registro: última actividad, último contacto y próxima actividad. */
export default async function ActivityDateFacts({ record, locale }: ActivityDateFactsProps) {
  const t = await getTranslations({ locale, namespace: 'crm' });
  return (
    <>
      {ACTIVITY_DATE_FIELDS.map((field) => {
        const raw = record[ACTIVITY_DATE_COLUMNS[field] as keyof typeof record];
        return (
          <div key={field}>
            <dt>{t(`activityDates.${field}`)}</dt>
            <dd className="num">{formatActivityDate(raw, locale) || '—'}</dd>
          </div>
        );
      })}
    </>
  );
}
