import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getPublicProfile, legacyBookPath } from '@/lib/calendar';
import CalIcon from '@/components/calendar/cal-icons';
import { resolveBrand } from '@/components/calendar/cal-utils';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

/**
 * /book/<x>: si <x> es un slug de los links viejos (antes de los handles),
 * redirige a /book/<handle>/<slug> conservando el pre-fill. Si no, es el
 * perfil público de esa persona con sus tipos de evento.
 */
export default async function BookHandlePage(props: {
  params: Promise<{ handle: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle, locale } = await props.params;
  const searchParams = await props.searchParams;
  const path = await legacyBookPath(handle);
  if (path) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') qs.set(k, v);
    const suffix = qs.toString();
    redirect(`/${locale}${path}${suffix ? `?${suffix}` : ''}`);
  }

  const profile = await getPublicProfile(handle);
  if (!profile) notFound();
  const t = await getTranslations({ locale, namespace: 'calendar.profile' });
  const brand = resolveBrand(profile.brand);

  return (
    <main className="bk bk-profile" style={{ '--bk': brand.color, '--bk-on': brand.on } as React.CSSProperties}>
      <div className="bk-profile-inner">
        <header className="bk-profile-head">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="bk-logo bk-logo-lg" />
          ) : (
            <span className="bk-monogram bk-monogram-lg" aria-hidden="true">
              {profile.name.trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <h1 className="bk-title">{profile.name}</h1>
          <p className="bk-muted">{t('sub')}</p>
        </header>
        {profile.eventTypes.length === 0 ? (
          <p className="bk-note bk-profile-empty">{t('empty')}</p>
        ) : (
          <ul className="bk-profile-list">
            {profile.eventTypes.map((et) => (
              <li key={et.id}>
                <Link href={`/book/${profile.handle}/${et.slug}`} className="bk-profile-item">
                  <span className="bk-profile-swatch" style={{ background: et.brand_color || et.color || brand.color }} aria-hidden="true" />
                  <span className="bk-profile-text">
                    <strong>{et.title}</strong>
                    {et.description && <span className="bk-muted">{et.description}</span>}
                  </span>
                  <span className="bk-profile-dur">
                    <CalIcon name="clock" />
                    {t('minutes', { n: et.duration_min })}
                  </span>
                  <CalIcon name="next" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
