import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import RoutingFormEditor from '@/components/calendar/RoutingFormEditor';

export const dynamic = 'force-dynamic';

export default async function NewRoutingFormPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventTypes = await listEventTypes(user.id);

  return (
    <div className="app-page narrow">
      <h1 className="app-title">{t('routing.newTitle')}</h1>
      <p className="app-sub muted">{t('routing.newSub')}</p>
      <RoutingFormEditor
        locale={locale}
        eventTypes={eventTypes.map((et) => ({ id: et.id, title: et.title, slug: et.slug }))}
      />
    </div>
  );
}
