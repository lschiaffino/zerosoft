import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { sessionGate } from '@/lib/session';
import { safeCallbackUrl } from '@/lib/hosts';
import ZeroTorus from '@/components/zero/ZeroTorus';
import Logo from '@/components/brand/Logo';
import MfaForm from '@/components/auth/MfaForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'common.auth.mfa' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Segundo paso del login (cuenta con verificación en dos pasos). */
export default async function MfaPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ callbackUrl?: string }> }) {
  const { locale } = await props.params;
  const { callbackUrl: raw } = await props.searchParams;
  const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
  const target = safeCallbackUrl(raw, base) ?? `/${locale}/app/start`;
  const gate = await sessionGate();
  if (gate.state === 'ok') redirect(target);
  if (gate.state !== 'mfa_pending') redirect(`/${locale}/auth/signin`);
  const t = await getTranslations({ locale, namespace: 'common.auth.mfa' });
  return (
    <main className="auth-page">
      <ZeroTorus interactive={false} className="zero-torus-bg" />
      <div className="auth-card">
        <Logo variant="symbol" tone="current" height={36} title="" />
        <h1>{t('title')}</h1>
        <p className="auth-sub">{t('sub')}</p>
        <MfaForm target={target} />
      </div>
    </main>
  );
}
