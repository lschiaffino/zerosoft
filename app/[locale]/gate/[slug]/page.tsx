import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import ZeroTorus from '@/components/zero/ZeroTorus';
import GateForm from '@/components/link/GateForm';
import { headers } from 'next/headers';
import { getLinkForHost, linkShortUrl } from '@/lib/links';
import { gateMetadata } from '@/lib/link-preview';
import { gateQueryString } from '@/lib/link-url';

export const dynamic = 'force-dynamic';

interface GatePageProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(props: GatePageProps) {
  return gateMetadata((await props.params).locale);
}

export default async function GatePage(props: GatePageProps) {
  const params = await props.params;

  const {
    locale,
    slug
  } = params;

  // Los params del link corto (utm_*, ?qr=1) vuelven a /<slug> tras desbloquear.
  const query = gateQueryString(await props.searchParams);
  const t = await getTranslations({ locale, namespace: 'link' });
  const link = await getLinkForHost((await headers()).get('host'), slug);

  if (!link) redirect(`/${locale}/gone?reason=notfound`);
  if (!link.password_hash) redirect(`/${slug}${query}`);

  return (
    <main className="auth-page">
      <ZeroTorus interactive={false} className="zero-torus-bg" />
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
        <GateForm slug={slug} query={query} />
      </div>
    </main>
  );
}
