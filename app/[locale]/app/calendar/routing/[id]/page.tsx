import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import { getRoutingForm, listRoutingSubmissions } from '@/lib/calendar-routing';
import PageHeader from '@/components/ui/PageHeader';
import RoutingFormEditor from '@/components/calendar/RoutingFormEditor';
import CalDeleteButton from '@/components/calendar/CalDeleteButton';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function RoutingFormDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const form = await getRoutingForm(user.id, id);
  if (!form) notFound();
  const eventTypes = await listEventTypes(user.id);
  const submissions = (await listRoutingSubmissions(user.id, id, 50)) ?? [];
  const origin = publicOrigin((await headers()).get('host'));

  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/calendar/routing', label: t('routing.title') }}
        title={
          <span className="cal-title-row">
            {form.title}
            {!form.active && <span className="badge">{t('routing.inactive')}</span>}
          </span>
        }
        description={t('routing.editorLead')}
        actions={
          <CalDeleteButton
            url={`/api/calendar/routing/${id}`}
            confirmText={t('routing.deleteConfirm', { title: form.title })}
            redirectTo="/app/calendar/routing"
          />
        }
      />
      <RoutingFormEditor
        initial={form}
        submissions={submissions}
        locale={locale}
        publicBase={`${origin}/${locale}/r/${user.handle ?? ''}/`}
        eventTypes={eventTypes.map((et) => ({ id: et.id, title: et.title, slug: et.slug }))}
      />
    </div>
  );
}
