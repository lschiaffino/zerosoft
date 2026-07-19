import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ZeroField from '@/components/ZeroField';
import GateForm from '@/components/link/GateForm';
import { getLinkBySlug } from '@/lib/links';
import { shortDomain, shortUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface GatePageProps {
  params: { locale: string; slug: string };
}

export async function generateMetadata({ params: { slug } }: GatePageProps) {
  const link = await getLinkBySlug(slug);
  if (!link) return {};
  return {
    title: link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`,
    description: link.og_description?.trim() || link.url,
    openGraph: link.og_image?.trim()
      ? {
          title: link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`,
          description: link.og_description?.trim() || link.url,
          images: [link.og_image.trim()],
          url: shortUrl(slug),
        }
      : undefined,
  };
}

export default async function GatePage({ params: { locale, slug } }: GatePageProps) {
  const t = await getTranslations({ locale, namespace: 'link' });
  const link = await getLinkBySlug(slug);

  if (!link) redirect(`/${locale}/gone?reason=notfound`);
  if (!link.password_hash) redirect(`/${slug}`);

  return (
    <main className="auth-page">
      <ZeroField align="center" sizeFactor={1.4} interactive={false} alpha={0.1} />
      <div className="auth-card">
        <span className="brand-zero" style={{ width: 44, height: 44, fontSize: 20 }}>
          0
        </span>
        <h1>{t('gate.title')}</h1>
        <p className="auth-sub">
          {t('gate.sub')}
          <br />
          <span className="mono gate-slug">
            {shortDomain()}/{slug}
          </span>
        </p>
        <GateForm slug={slug} />
      </div>
    </main>
  );
}
