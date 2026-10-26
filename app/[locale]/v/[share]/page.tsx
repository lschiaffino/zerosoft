import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { publicPreview, recShareUrl, resolvePublicPage } from '@/lib/rec-page';
import RecWatch from '@/components/rec/RecWatch';
import RecGate from '@/components/rec/RecGate';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; share: string }> };

export async function generateMetadata(props: Props) {
  const { locale, share } = await props.params;
  const page = await resolvePublicPage(share);
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  const title = page.state === 'ok' ? page.video.title : t('metaLocked');
  // Tarjeta del link (Slack, WhatsApp, mail) solo para videos abiertos a cualquiera.
  const og = await publicPreview(locale, share);
  return {
    title,
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
    ...(og
      ? {
          description: og.description || undefined,
          openGraph: { title: og.title, description: og.description || undefined, url: og.url, type: 'video.other' as const, images: og.image ? [{ url: og.image }] : undefined },
          twitter: { card: og.image ? ('summary_large_image' as const) : ('summary' as const), title: og.title, images: og.image ? [og.image] : undefined },
        }
      : {}),
  };
}

/** Video compartido por link (como la página de un Loom). */
export default async function RecPublicPage(props: Props) {
  const { locale, share } = await props.params;
  setRequestLocale(locale);
  const page = await resolvePublicPage(share);
  if (page.state === 'not_found') notFound();
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  if (page.state !== 'ok') {
    const back = `/${locale}/v/${share}`;
    return (
      <main className="rec-watch rec-gate" data-testid="rec-gate" data-state={page.state}>
        <div className="rec-gate-card">
          <h1 className="rec-watch-title">{t(`gate.${page.state}.title`)}</h1>
          <p className="muted">{t(`gate.${page.state}.body`, { title: page.title })}</p>
          {page.state === 'password' && <RecGate shareId={share} />}
          {page.state === 'signin' && (
            <Link className="btn btn-primary" href={`/auth/signin?callbackUrl=${encodeURIComponent(back)}`}>
              {t('signIn')}
            </Link>
          )}
        </div>
      </main>
    );
  }
  return <RecWatch video={page.video} shareUrl={recShareUrl(locale, share)} member={page.member} />;
}
