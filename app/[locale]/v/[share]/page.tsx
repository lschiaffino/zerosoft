import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { publicPreview, recBaseUrl, recShareUrl, resolvePublicPage } from '@/lib/rec-page';
import RecWatch from '@/components/rec/RecWatch';
import RecGate from '@/components/rec/RecGate';
import { RecEmailGate, RecMagicLink, RecOpenInvite, RecRequestAccess } from '@/components/rec/RecAccessGate';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; share: string }> };

export async function generateMetadata(props: Props) {
  const { locale, share } = await props.params;
  const page = await resolvePublicPage(share);
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  const name = page.state === 'ok' ? page.video.title : t('metaLocked');
  // Con marca propia, la pestaña no dice zerosoft.
  const title = page.state === 'ok' && page.brand ? { absolute: name } : name;
  // Tarjeta del link (Slack, WhatsApp, mail) solo para videos abiertos a cualquiera.
  const og = await publicPreview(locale, share);
  return {
    title,
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
    ...(og
      ? {
          description: og.description || undefined,
          alternates: { types: { 'application/json+oembed': `${recBaseUrl()}/api/rec/oembed?url=${encodeURIComponent(og.url)}` } },
          openGraph: { title: og.title, description: og.description || undefined, url: og.url, type: 'video.other' as const, images: og.image ? [{ url: og.image }] : undefined },
          twitter: { card: og.image ? ('summary_large_image' as const) : ('summary' as const), title: og.title, images: og.image ? [og.image] : undefined },
        }
      : {}),
  };
}

/** Video compartido por link (como la página de un Loom). */
export default async function RecPublicPage(props: Props & { searchParams: Promise<{ invite?: string | string[] }> }) {
  const { locale, share } = await props.params;
  const sp = await props.searchParams;
  const invite = typeof sp.invite === 'string' && /^[\w-]{20,64}$/.test(sp.invite) ? sp.invite : null;
  setRequestLocale(locale);
  const page = await resolvePublicPage(share);
  if (page.state === 'not_found') notFound();
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  if (page.state !== 'ok') {
    const back = `/${locale}/v/${share}`;
    // Link mágico de una invitación: se usa con un clic (los antivirus del correo no lo gastan al abrirlo).
    if (invite) {
      return (
        <main className="rec-watch rec-gate" data-testid="rec-gate" data-state="invite">
          <div className="rec-gate-card">
            <h1 className="rec-watch-title">{t('gate.invite.title')}</h1>
            <p className="muted">{t('gate.invite.body')}</p>
            <RecOpenInvite shareId={share} token={invite} />
          </div>
        </main>
      );
    }
    return (
      <main className="rec-watch rec-gate" data-testid="rec-gate" data-state={page.state}>
        <div className="rec-gate-card">
          <h1 className="rec-watch-title">{t(`gate.${page.state}.title`)}</h1>
          <p className="muted">{t(`gate.${page.state}.body`, { title: page.title })}</p>
          {page.state === 'password' && <RecGate shareId={share} />}
          {page.state === 'email' && <RecEmailGate shareId={share} />}
          {page.state === 'forbidden' && page.signedIn && <RecRequestAccess shareId={share} initial={page.requestStatus} />}
          {page.state === 'signin' && (
            <Link className="btn btn-primary" href={`/auth/signin?callbackUrl=${encodeURIComponent(back)}`}>
              {t('signIn')}
            </Link>
          )}
          {(page.state === 'signin' || page.state === 'forbidden') && <RecMagicLink shareId={share} />}
        </div>
      </main>
    );
  }
  return <RecWatch video={page.video} shareUrl={recShareUrl(locale, share)} member={page.member} brand={page.brand} />;
}
