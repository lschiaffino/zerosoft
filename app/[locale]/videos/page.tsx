import { getTranslations, setRequestLocale } from 'next-intl/server';
import VideoPlayer from '@/components/VideoPlayer';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'videos' });
  return { title: t('meta.title'), description: t('meta.description') };
}

/** Videos en public/videos/<id>.mp4 + <id>.jpg (grabaciones reales del app). */
const VIDEOS = [
  { id: 'zerosoft-intro', color: 'var(--ink)' },
  { id: 'crm', color: 'var(--c-crm)' },
  { id: 'link', color: 'var(--c-link)' },
  { id: 'cal', color: 'var(--c-cal)' },
  { id: 'track', color: 'var(--c-track)' },
  { id: 'chat', color: 'var(--c-chat)' },
  { id: 'docs', color: 'var(--c-docs)' },
] as const;

export default async function VideosPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'videos' });

  return (
    <main>
      <section className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <h1 className="doc-title">{t('title')}</h1>
        <p className="doc-intro">{t('sub')}</p>
      </section>

      <section className="container" style={{ paddingTop: 0, paddingBottom: 90 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
            gap: 40,
          }}
        >
          {VIDEOS.map((v) => (
            <article key={v.id} id={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
                <VideoPlayer
                  src={`/videos/${v.id}.mp4`}
                  poster={`/videos/${v.id}.jpg`}
                  title={t(`items.${v.id}.title`)}
                />
              </div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, letterSpacing: '-0.01em' }}>
                <span
                  aria-hidden
                  style={{ width: 10, height: 10, borderRadius: '50%', background: v.color, flex: 'none' }}
                />
                {t(`items.${v.id}.title`)}
                <span className="mono" style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 400 }}>
                  {t(`items.${v.id}.duration`)}
                </span>
              </h2>
              <p style={{ color: 'var(--dim)', lineHeight: 1.55 }}>{t(`items.${v.id}.desc`)}</p>
            </article>
          ))}
        </div>
        <p className="mono" style={{ marginTop: 48, fontSize: 12, color: 'var(--dim)' }}>
          {t('note')}
        </p>
      </section>
    </main>
  );
}
