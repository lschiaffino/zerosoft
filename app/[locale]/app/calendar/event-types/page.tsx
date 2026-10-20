import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import PageHeader from '@/components/ui/PageHeader';
import EventTypesView, { NewEventTypeButton, NewOneOffButton } from '@/components/calendar/EventTypesView';
import { publicOrigin, toListItems } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function EventTypesPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const searchParams = await props.searchParams;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventTypes = await listEventTypes(user.id);
  const origin = publicOrigin((await headers()).get('host'));

  return (
    <div className="ui-page">
      <PageHeader title={t('eventTypes.title')} description={t('eventTypes.lead')} actions={
          <>
            <NewOneOffButton />
            <NewEventTypeButton />
          </>
        } />
      <EventTypesView
        items={toListItems(eventTypes)}
        handle={user.handle ?? ''}
        bookBase={`${origin}/${locale}/book`}
        openNew={searchParams.new === '1'}
      />
    </div>
  );
}
