import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicVideo } from '@/lib/crm-media';
import VideoWatch from '@/components/crm/VideoWatch';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const video = await getPublicVideo(token);
  const t = await getTranslations({ locale, namespace: 'crm.mediaPublic' });
  return { title: video?.title ?? t('notFound'), robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/** Página propia de un video 1:1: saludo, video y mensaje. Cada reproducción queda en el CRM. */
export default async function PublicVideoPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const video = await getPublicVideo(token);
  if (!video) notFound();
  const t = await getTranslations({ locale, namespace: 'crm.mediaPublic' });
  return (
    <main className="vw-main">
      <article className="vw-card">
        <p className="vw-kicker">
          {video.contactFirstName ? t('greeting', { name: video.contactFirstName }) : t('greetingAnon')}
        </p>
        <h1 className="vw-title">{video.title}</h1>
        <VideoWatch token={token} src={`/api/crm/v/${encodeURIComponent(token)}/file`} type={video.contentType} title={video.title} />
        {video.message && <p className="vw-message">{video.message}</p>}
        {video.senderName && <p className="vw-from">{t('from', { name: video.senderName })}</p>}
      </article>
    </main>
  );
}
