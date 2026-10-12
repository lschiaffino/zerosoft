import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import { getRoutingForm } from '@/lib/calendar-routing';
import RoutingFormEditor from '@/components/calendar/RoutingFormEditor';

export const dynamic = 'force-dynamic';

export default async function RoutingFormDetailPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const form = await getRoutingForm(user.id, id);
  if (!form) notFound();
  const eventTypes = await listEventTypes(user.id);

  return (
    <div className="app-page">
      <Link href="/app/calendar/routing" className="mono back-link">
        {t('routing.back')}
      </Link>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{form.title}</h1>
          {!form.active && <span className="badge">{t('routing.inactive')}</span>}
        </div>
        <div className="detail-meta">
          <span className="detail-meta-item mono">/r/{form.slug}</span>
        </div>
      </header>

      <RoutingFormEditor
        initial={form}
        locale={locale}
        eventTypes={eventTypes.map((et) => ({ id: et.id, title: et.title, slug: et.slug }))}
      />
    </div>
  );
}
