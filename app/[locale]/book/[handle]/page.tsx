import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getPublicProfile, legacyBookPath } from '@/lib/calendar';
import CalIcon from '@/components/calendar/cal-icons';
import { resolveBrand } from '@/components/calendar/cal-utils';
import PublicPageExtras from '@/components/calendar/PublicPageExtras';
import { hostToken, parseHostToken } from '@/lib/calendar-host-token';
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
  // Página de una persona del equipo (?host=): sus tipos de evento, y la reserva va con ella.
  const hostParam = typeof searchParams.host === 'string' ? searchParams.host : '';
  const hostId = parseHostToken(hostParam);
  const member = profile.members.find((m) => m.id === hostId) ?? null;
  const eventTypes = member ? profile.eventTypes.filter((et) => member.eventTypeIds.includes(et.id)) : profile.eventTypes;
  const hostQs = member ? `?host=${encodeURIComponent(hostParam)}` : '';

  return (
    <main className="bk bk-profile" style={{ '--bk': brand.color, '--bk-on': brand.on } as React.CSSProperties}>
      <PublicPageExtras workspaceId={profile.userId} />
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
          <h1 className="bk-title">{member ? member.name : profile.name}</h1>
          <p className="bk-muted">{member ? t('memberSub', { team: profile.name }) : t('sub')}</p>
          {member && (
            <Link href={`/book/${profile.handle}`} className="bk-link">
              {t('backToTeam', { team: profile.name })}
            </Link>
          )}
        </header>
        {eventTypes.length === 0 ? (
          <p className="bk-note bk-profile-empty">{t('empty')}</p>
        ) : (
          <ul className="bk-profile-list">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Link href={`/book/${profile.handle}/${et.slug}${hostQs}`} className="bk-profile-item">
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
        {!member && profile.members.length > 1 && (
          <section className="bk-team" aria-labelledby="bk-team-title">
            <h2 id="bk-team-title" className="bk-h2">
              {t('team')}
            </h2>
            <ul className="bk-team-list">
              {profile.members.map((m) => (
                <li key={m.id}>
                  <Link href={`/book/${profile.handle}?host=${encodeURIComponent(hostToken(m.id))}`} className="bk-team-member">
                    <span className="bk-monogram" aria-hidden="true">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>{m.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
