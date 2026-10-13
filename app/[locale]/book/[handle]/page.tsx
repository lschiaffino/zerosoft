import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getPublicProfile, legacyBookPath } from '@/lib/calendar';
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

  return (
    <main className="book-profile">
      <div className="book-profile-head">
        <span className="book-profile-avatar" aria-hidden="true">
          {profile.name.slice(0, 1).toUpperCase()}
        </span>
        <h1>{profile.name}</h1>
        <p className="muted">{t('sub')}</p>
      </div>
      {profile.eventTypes.length === 0 ? (
        <p className="muted book-profile-empty">{t('empty')}</p>
      ) : (
        <ul className="book-profile-list">
          {profile.eventTypes.map((et) => (
            <li key={et.id}>
              <Link href={`/book/${profile.handle}/${et.slug}`} className="book-profile-item">
                <span className="book-profile-dot" style={{ background: et.color || 'var(--c-cal)' }} aria-hidden="true" />
                <span className="book-profile-text">
                  <strong>{et.title}</strong>
                  {et.description && <span className="muted">{et.description}</span>}
                </span>
                <span className="book-profile-dur mono">{t('minutes', { n: et.duration_min })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
