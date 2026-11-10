import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser, userCanUseApp } from '@/lib/session';
import { APP_SWITCHER_ORDER, comingSoonHref, isComingSoon, isProductKey, PRODUCT_CONFIG } from '@/lib/products';
import { isStaff } from '@/lib/workspace-apps';
import { joinedApps } from '@/lib/waitlist';
import ProductGlyph from '@/components/brand/ProductGlyph';
import WaitlistForm from '@/components/waitlist/WaitlistForm';
import { waitlistLabels } from '@/components/waitlist/labels';
import '@/styles/waitlist.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string; app: string }> }): Promise<Metadata> {
  const { locale, app } = await props.params;
  if (!isProductKey(app)) return {};
  const t = await getTranslations({ locale, namespace: 'common.comingSoon' });
  return { title: `${PRODUCT_CONFIG[app].name} · ${t('badge')}`, robots: { index: false } };
}

/**
 * Página de una app "Próximamente" dentro de la app: qué es, que todavía no se
 * puede usar y la lista de espera en un clic. Una app que ya salió lleva a la app.
 */
export default async function ComingSoonPage(props: { params: Promise<{ locale: string; app: string }> }) {
  const { locale, app } = await props.params;
  if (!isProductKey(app)) notFound();
  if (!isComingSoon(app)) redirect(`/${locale}${PRODUCT_CONFIG[app].launch}`);
  const user = await requireUser(locale);
  const person = user.actingUser ?? user;
  const name = PRODUCT_CONFIG[app].name;
  const [t, tProducts, labels, joined] = await Promise.all([
    getTranslations({ locale, namespace: 'common.comingSoon' }),
    getTranslations({ locale, namespace: 'common.products' }),
    waitlistLabels(locale, name, person.email),
    joinedApps(person.email),
  ]);
  const preview = isStaff(person.email) && userCanUseApp(user, app);
  const others = APP_SWITCHER_ORDER.filter((k) => isComingSoon(k) && k !== app);

  return (
    <div className="app-page wait-page" data-testid="coming-soon-page">
      <div className={`wait-card card-${app}`}>
        <p className="wait-kicker">
          <ProductGlyph product={app} size={16} />
          <span>{name}</span>
          <span className="wait-badge">{t('badge')}</span>
        </p>
        <h1 className="wait-title">{t('title', { name })}</h1>
        <p className="wait-desc">{tProducts(`${app}.desc`)}</p>
        <p className="wait-lead">{t('lead', { name })}</p>
        <WaitlistForm app={app} locale={locale} signedIn alreadyJoined={joined.includes(app)} labels={labels} />
        {preview && (
          <p className="wait-preview">
            <Link href={PRODUCT_CONFIG[app].launch} className="lp-textlink">
              {t('openPreview', { name })}
            </Link>
          </p>
        )}
      </div>
      {others.length > 0 && (
        <section className="wait-others" aria-labelledby="wait-others">
          <h2 id="wait-others" className="home-h">
            {t('others')}
          </h2>
          <ul className="home-more-list">
            {others.map((k) => (
              <li key={k}>
                <Link href={comingSoonHref(k)} className={`home-more-app card-${k}`}>
                  <ProductGlyph product={k} size={14} />
                  <span className="home-more-name">{PRODUCT_CONFIG[k].name}</span>
                  <span className="home-more-desc">{tProducts(`${k}.desc`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="wait-back">
        <Link href="/app" className="lp-textlink">
          {t('back')}
        </Link>
      </p>
    </div>
  );
}
