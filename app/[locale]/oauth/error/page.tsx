import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Logo from '@/components/brand/Logo';
import '@/styles/oauth.css';

const REASONS = new Set(['client', 'redirect', 'response_type', 'pkce', 'scope', 'resource', 'state']);

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.oauth' });
  return { title: t('invalidTitle'), robots: { index: false, follow: false } };
}

/** Un pedido de autorización inválido termina acá, nunca en una URI que registró cualquiera. */
export default async function OAuthErrorPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ reason?: string }> }) {
  const { locale } = await props.params;
  const { reason } = await props.searchParams;
  const t = await getTranslations({ locale, namespace: 'settings.oauth' });
  return (
    <main className="auth-page oauth-page">
      <div className="auth-card oauth-card">
        <Logo variant="symbol" tone="current" height={32} title="zerosoft" />
        <h1>{t('invalidTitle')}</h1>
        <p className="auth-sub">{t('invalidBody')}</p>
        {reason && REASONS.has(reason) ? <p className="oauth-origin oauth-reason">{t('invalidCode', { code: reason })}</p> : null}
      </div>
    </main>
  );
}
