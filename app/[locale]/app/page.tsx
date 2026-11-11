import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, requireUser, userCanUseApp } from '@/lib/session';
import { dayPart, getWorkspaceMode, homeCanUse } from '@/lib/home';
import { getUserTimeZone } from '@/lib/user-tz';
import { featuredApps, moreAppsByCategory } from '@/lib/workspace-mode';
import { APP_SWITCHER_ORDER, comingSoonHref, isComingSoon, PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { isStaff, loadWorkspaceAppRules } from '@/lib/workspace-apps';
import { appDenial } from '@/lib/app-access';
import ProductGlyph from '@/components/brand/ProductGlyph';
import PageHeader from '@/components/ui/PageHeader';
import RequestAccessButton from '@/components/app/RequestAccessButton';
import LostAccessNotice from '@/components/app/LostAccessNotice';
import { isRequestPending, lostAccessNotice } from '@/lib/workspace-access-request';
import { chosenApps } from '@/lib/onboarding';
import { getOnboardingState } from '@/lib/onboarding-state';
import GettingStarted from '@/components/app/home/GettingStarted';

export const dynamic = 'force-dynamic';

/**
 * Inicio de la plataforma: el saludo y tus apps, cada una con su ícono y para
 * qué sirve. Nada más: lo del día vive en cada app y el asistente se abre con
 * ⌘J desde cualquier lado. Arriba, solo los avisos que hacen falta (acceso
 * bloqueado, acceso perdido, primeros pasos).
 */
export default async function PlatformHomePage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [t, tProducts, mode, timeZone] = await Promise.all([
    getTranslations({ locale, namespace: 'common.appHome' }),
    getTranslations({ locale, namespace: 'common.products' }),
    getWorkspaceMode(user),
    getUserTimeZone(),
  ]);

  const person = user.actingUser ?? user;
  const firstName = (person.name ?? '').trim().split(/\s+/)[0] ?? '';
  const part = dayPart(timeZone);
  const partKey = part === 'morning' ? 'Morning' : part === 'afternoon' ? 'Afternoon' : 'Evening';
  const greeting = firstName ? t(`greeting${partKey}`, { name: firstName }) : t(`greeting${partKey}Anon`);

  const admin = isWorkspaceAdmin(user);
  // Solo las apps que la persona tiene en este workspace; las "Próximamente" van aparte, al pie.
  const ready = (k: ProductKey) => homeCanUse(user, k) && !isComingSoon(k);
  // Las que la persona eligió al empezar (o las del modo) primero, después el resto en el orden del menú.
  const chosen = chosenApps(person.profile);
  const featured = featuredApps({ mode, chosen }).filter(ready);
  const rest = moreAppsByCategory({ mode, chosen }).flatMap((g) => g.apps).filter(ready);
  const apps = [...new Set([...featured, ...rest])];
  // Inbox es personal (la tiene todo el mundo): no cuenta como acceso al workspace.
  const workspaceApps = apps.filter((k) => k !== 'inbox');
  const staff = isStaff(person.email);
  const soon = APP_SWITCHER_ORDER.filter((k) => isComingSoon(k));
  const tSoon = await getTranslations({ locale, namespace: 'common.comingSoon' });
  const blockedKey = (await props.searchParams).blocked;
  // El link puede quedar viejo: si ya tiene la app (se la dieron), no hay nada que avisar.
  const blocked = typeof blockedKey === 'string' && blockedKey in PRODUCT_CONFIG && !userCanUseApp(user, blockedKey as ProductKey) ? (blockedKey as ProductKey) : null;
  const tAccess = blocked ? await getTranslations({ locale, namespace: 'settings.access' }) : null;
  // Apagada o restringida por el workspace (Ajustes › Workspace › Apps) y no por los toggles de la persona: otro aviso, sin pedir acceso.
  const wsDenial = blocked
    ? appDenial({ role: user.role, personId: person.id, teamIds: [], staff: isStaff(person.email) }, blocked, await loadWorkspaceAppRules(user.id))
    : null;
  const wsOff = wsDenial === 'workspace_off';
  // "Pedido enviado" sigue al recargar: sale de la base, no del estado del botón.
  const alreadyAsked = Boolean(blocked && user.actingUser && user.workspace && (await isRequestPending(user.workspace.id, person.id, blocked)));
  const [lost, onboarding] = await Promise.all([
    lostAccessNotice(person.id),
    getOnboardingState(person.id, { workspaceId: user.id, admin }).catch(() => null),
  ]);

  return (
    <div className="app-page app-home app-home-clean" data-mode={mode}>
      <PageHeader title={greeting} description={t('homeLeadApps')} />
      {blocked && tAccess && (
        <div className="home-blocked" role="status" data-testid="home-blocked">
          <p className="home-blocked-title">{tAccess(wsOff ? 'offTitle' : 'title', { app: PRODUCT_CONFIG[blocked].name })}</p>
          <p className="home-blocked-body">
            {wsOff
              ? tAccess(admin ? 'offBodyAdmin' : 'offBody', { app: PRODUCT_CONFIG[blocked].name, workspace: user.workspace?.name ?? '' })
              : tAccess(user.role === 'admin' ? 'bodyAdmin' : 'body', { app: PRODUCT_CONFIG[blocked].name, workspace: user.workspace?.name ?? '' })}
          </p>
          {user.actingUser && !wsOff && (
            <RequestAccessButton
              app={blocked}
              alreadyAsked={alreadyAsked}
              labels={{ request: tAccess('request'), sending: tAccess('sending'), sent: tAccess('sent'), already: tAccess('already'), hasAccess: tAccess('hasAccess'), limited: tAccess('limited'), error: tAccess('error') }}
            />
          )}
        </div>
      )}

      {lost && <LostAccessNotice id={lost.id} title={lost.title} body={lost.body} />}

      {onboarding?.showChecklist && <GettingStarted state={onboarding} locale={locale} />}

      {workspaceApps.length === 0 && (
        <div className="home-no-apps" data-testid="home-no-apps">
          <p className="home-blocked-title">{t('noApps.title')}</p>
          <p className="home-blocked-body">{t(user.role === 'admin' ? 'noApps.bodyAdmin' : 'noApps.body', { workspace: user.workspace?.name ?? '' })}</p>
        </div>
      )}

      {apps.length > 0 && (
        <nav className="home-apps" aria-label={t('featured')} data-testid="home-featured">
          <ul>
            {apps.map((k, i) => (
              <li key={k} style={{ ['--i' as string]: i }}>
                <Link href={PRODUCT_CONFIG[k].launch} className={`home-tile card-${k}`} aria-label={t('open', { name: PRODUCT_CONFIG[k].name })}>
                  <span className="home-tile-icon" aria-hidden="true">
                    <ProductGlyph product={k} size={30} />
                  </span>
                  <span className="home-tile-name">{PRODUCT_CONFIG[k].name}</span>
                  <span className="home-tile-desc">{tProducts(`${k}.desc`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {soon.length > 0 && (
        <section className="home-soon" aria-labelledby="home-soon-title" data-testid="home-soon">
          <h2 id="home-soon-title" className="home-soon-title">
            {tSoon('badge')}
          </h2>
          <ul className="home-soon-list">
            {soon.map((k) => (
              <li key={k}>
                <Link
                  href={staff && userCanUseApp(user, k) ? PRODUCT_CONFIG[k].launch : comingSoonHref(k)}
                  className="home-soon-app"
                  title={tProducts(`${k}.desc`)}
                >
                  <ProductGlyph product={k} size={12} />
                  <span>{PRODUCT_CONFIG[k].name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
