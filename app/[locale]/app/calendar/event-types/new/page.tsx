import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import EventTypeForm from '@/components/calendar/EventTypeForm';

export const dynamic = 'force-dynamic';

export default async function NewEventTypePage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('eventTypes.newTitle')}</h1>
      <p className="app-sub muted">{t('eventTypes.newSub')}</p>
      <EventTypeForm />
    </div>
  );
}
