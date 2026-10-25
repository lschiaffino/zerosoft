import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { dayPart, getWorkspaceMode, normalizeTaskScope } from '@/lib/home';
import { getUserTimeZone } from '@/lib/user-tz';
import { featuredApps, moreAppsByCategory, showTeamUi } from '@/lib/workspace-mode';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import ProductGlyph from '@/components/brand/ProductGlyph';
import PageHeader from '@/components/ui/PageHeader';
import {
  CalBookingsBlock,
  CrmTasksBlock,
  HomeBlockLoading,
  RecentBlock,
  RecentLoading,
  TrackIssuesBlock,
  UnreadBlock,
} from '@/components/app/home/HomeBlocks';

export const dynamic = 'force-dynamic';

/**
 * Inicio de la plataforma: saludo, "Para hoy" (CRM, Track, Cal, sin leer),
 * recientes de todas las apps, las apps destacadas según el modo del
 * workspace y el resto por categoría. Cada bloque con datos va en su propio
 * Suspense: la página pinta enseguida y cada bloque llega cuando está.
 */
export default async function PlatformHomePage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const taskScope = normalizeTaskScope((await props.searchParams).tasks);
  const user = await requireUser(locale);
  const [t, tProducts, tCat, mode, timeZone] = await Promise.all([
    getTranslations({ locale, namespace: 'common.appHome' }),
    getTranslations({ locale, namespace: 'common.products' }),
    getTranslations({ locale, namespace: 'common.categories' }),
    getWorkspaceMode(user),
    getUserTimeZone(),
  ]);

  const person = user.actingUser ?? user;
  const firstName = (person.name ?? '').trim().split(/\s+/)[0] ?? '';
  const part = dayPart(timeZone);
  const partKey = part === 'morning' ? 'Morning' : part === 'afternoon' ? 'Afternoon' : 'Evening';
  const greeting = firstName ? t(`greeting${partKey}`, { name: firstName }) : t(`greeting${partKey}Anon`);

  const team = showTeamUi(mode);
  // Invitar e importar son de quien administra el workspace.
  const admin = isWorkspaceAdmin(user);
  const featured = featuredApps({ mode });
  const more = moreAppsByCategory({ mode });

  const appCard = (k: ProductKey) => (
    <li key={k}>
      <Link href={PRODUCT_CONFIG[k].launch} className={`app-home-app card-${k}`} aria-label={t('open', { name: PRODUCT_CONFIG[k].name })}>
        <ProductGlyph product={k} size={20} />
        <span className="app-home-app-name">{PRODUCT_CONFIG[k].name}</span>
        <span className="app-home-app-desc">{tProducts(`${k}.desc`)}</span>
      </Link>
    </li>
  );

  return (
    <div className="app-page app-home" data-mode={mode}>
      <PageHeader title={greeting} description={t('homeLead')} />

      <section className="home-section" aria-labelledby="home-today">
        <h2 id="home-today" className="home-h">
          {t('today.title')}
        </h2>
        <div className="home-today">
          <Suspense
            fallback={<HomeBlockLoading locale={locale} product="crm" titleKey="today.crm" href="/app/crm/tasks" testId="home-crm-tasks" />}
          >
            {/* En uso personal el CRM no está destacado: el bloque aparece solo si hay tareas. */}
            <CrmTasksBlock user={user} locale={locale} hideWhenEmpty={!team} scope={taskScope} />
          </Suspense>
          <Suspense
            fallback={
              <HomeBlockLoading locale={locale} product="track" titleKey="today.track" href="/app/track/my-tasks" testId="home-track" />
            }
          >
            <TrackIssuesBlock user={user} locale={locale} />
          </Suspense>
          <Suspense
            fallback={
              <HomeBlockLoading locale={locale} product="cal" titleKey="today.cal" href="/app/calendar/bookings" testId="home-cal" />
            }
          >
            <CalBookingsBlock user={user} locale={locale} timeZone={timeZone} />
          </Suspense>
          <Suspense
            fallback={
              <HomeBlockLoading locale={locale} product="chat" titleKey="today.inbox" href="/app/chat/inbox" testId="home-unread" />
            }
          >
            <UnreadBlock user={user} locale={locale} hideWhenEmpty={!team} />
          </Suspense>
        </div>
      </section>

      <div className={`home-split${admin ? '' : ' home-split-full'}`}>
        <section className="home-section" aria-labelledby="home-recent">
          <h2 id="home-recent" className="home-h">
            {t('recent.title')}
          </h2>
          <Suspense fallback={<RecentLoading locale={locale} />}>
            <RecentBlock user={user} locale={locale} />
          </Suspense>
        </section>

        {admin && (
          <aside className="home-cards" aria-label={t('import.title')}>
            {team && (
              <div className="home-card" data-testid="home-invite">
                <h3 className="home-card-title">{t('invite.title')}</h3>
                <p className="home-card-body">{t('invite.body')}</p>
                <Link href="/app/settings/members" className="btn btn-secondary btn-sm">
                  {t('invite.cta')}
                </Link>
              </div>
            )}
            <div className="home-card" data-testid="home-import">
              <h3 className="home-card-title">{t('import.title')}</h3>
              <p className="home-card-body">{t('import.body')}</p>
              <Link href="/app/settings/import" className="btn btn-secondary btn-sm">
                {t('import.cta')}
              </Link>
            </div>
          </aside>
        )}
      </div>

      <section className="home-section" aria-labelledby="home-apps">
        <h2 id="home-apps" className="home-h">
          {t('featured')}
        </h2>
        <nav className="app-home-apps" aria-labelledby="home-apps" data-testid="home-featured">
          <ul>{featured.map(appCard)}</ul>
        </nav>
      </section>

      {more.length > 0 && (
        <section className="home-section" aria-labelledby="home-more">
          <h2 id="home-more" className="home-h">
            {t('more')}
          </h2>
          <div className="home-more" data-testid="home-more">
            {more.map(({ category, apps }) => (
              <div key={category} className="home-more-group">
                <h3 className="home-more-title">{tCat(`${category}.title`)}</h3>
                <ul className="home-more-list">
                  {apps.map((k) => (
                    <li key={k}>
                      <Link href={PRODUCT_CONFIG[k].launch} className={`home-more-app card-${k}`}>
                        <ProductGlyph product={k} size={14} />
                        <span className="home-more-name">{PRODUCT_CONFIG[k].name}</span>
                        <span className="home-more-desc">{tProducts(`${k}.desc`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
