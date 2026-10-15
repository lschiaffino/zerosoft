import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ZeroField from '@/components/ZeroField';
import GateForm from '@/components/link/GateForm';
import { headers } from 'next/headers';
import { getLinkForHost, linkShortUrl } from '@/lib/links';

export const dynamic = 'force-dynamic';

interface GatePageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: GatePageProps) {
  const params = await props.params;

  const {
    slug
  } = params;

  const link = await getLinkForHost((await headers()).get('host'), slug);
  if (!link) return {};
  return {
    title: link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`,
    description: link.og_description?.trim() || link.url,
    openGraph: link.og_image?.trim()
      ? {
          title: link.og_title?.trim() || link.title?.trim() || `${slug} — zerosoft.ai`,
          description: link.og_description?.trim() || link.url,
          images: [link.og_image.trim()],
          url: linkShortUrl(link),
        }
      : undefined,
  };
}

export default async function GatePage(props: GatePageProps) {
  const params = await props.params;

  const {
    locale,
    slug
  } = params;

  const qr = (await props.searchParams)?.qr === '1';
  const t = await getTranslations({ locale, namespace: 'link' });
  const link = await getLinkForHost((await headers()).get('host'), slug);

  if (!link) redirect(`/${locale}/gone?reason=notfound`);
  if (!link.password_hash) redirect(`/${slug}${qr ? '?qr=1' : ''}`);

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
            {linkShortUrl(link).replace(/^https?:\/\//, '')}
          </span>
        </p>
        <GateForm slug={slug} qr={qr} />
      </div>
    </main>
  );
}
