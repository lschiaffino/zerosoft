import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listRoutingForms } from '@/lib/calendar-routing';

export const dynamic = 'force-dynamic';

export default async function RoutingFormsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const forms = await listRoutingForms(user.id);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('routing.title')}</h1>
        <Link href="/app/calendar/routing/new" className="btn btn-solid btn-small">
          {t('routing.newCta')}
        </Link>
      </div>

      {forms.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('routing.emptyTitle')}</h2>
          <p className="muted">{t('routing.emptySub')}</p>
          <Link href="/app/calendar/routing/new" className="btn btn-solid btn-small">
            {t('routing.emptyCta')}
          </Link>
        </div>
      ) : (
        <section className="panel">
          <ul className="calendar-event-list">
            {forms.map((form) => (
              <li key={form.id}>
                <Link href={`/app/calendar/routing/${form.id}`} className="calendar-event-row">
                  <span className="calendar-event-title">{form.title}</span>
                  <span className="mono calendar-event-slug">/r/{form.slug}</span>
                  {!form.active && <span className="badge">{t('routing.inactive')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
