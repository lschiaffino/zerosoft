import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { recShareUrl, resolvePublicPage } from '@/lib/rec-page';
import RecEmbed from '@/components/rec/RecEmbed';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; share: string }> };

export async function generateMetadata(props: Props) {
  const { locale, share } = await props.params;
  const page = await resolvePublicPage(share);
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  return { title: page.state === 'ok' ? page.video.title : t('metaLocked'), robots: { index: false, follow: false } };
}

/** Reproductor solo, para insertar en un iframe (Notion, Docs, una web). Con contraseña o privado, manda a la página. */
export default async function RecEmbedPage(props: Props) {
  const { locale, share } = await props.params;
  setRequestLocale(locale);
  const page = await resolvePublicPage(share);
  if (page.state === 'not_found') notFound();
  const t = await getTranslations({ locale, namespace: 'rec.watch' });
  const url = recShareUrl(locale, share);
  if (page.state !== 'ok') {
    return (
      <main className="rec-embed rec-embed-locked">
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
          {t(`gate.${page.state}.title`)}
        </a>
      </main>
    );
  }
  return <RecEmbed video={page.video} shareUrl={url} />;
}
