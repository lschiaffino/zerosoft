import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import ZeroTorus from '@/components/zero/ZeroTorus';
import Logo from '@/components/brand/Logo';
import GoogleButton from '@/components/auth/GoogleButton';
import EmailCodeForm from '@/components/auth/EmailCodeForm';
import { emailLoginEnabled } from '@/lib/email-login';
import { safeCallbackUrl } from '@/lib/hosts';

export const dynamic = 'force-dynamic';

export default async function SignInPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await props.params;
  const { callbackUrl: rawCallback } = await props.searchParams;

  const {
    locale
  } = params;

  // ?callbackUrl= vuelve a donde estaba la persona (p. ej. el board en
  // feedback.zerosoft.ai). Solo paths del sitio o hosts de la app.
  const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
  const callbackUrl = safeCallbackUrl(rawCallback, base) ?? undefined;

  const user = await getCurrentUser();
  if (user) redirect(callbackUrl ?? `/${locale}/app`);

  const t = await getTranslations({ locale, namespace: 'common.auth' });

  return (
    <main className="auth-page">
      <ZeroTorus interactive={false} className="zero-torus-bg" />
      <div className="auth-card">
        <Logo variant="symbol" tone="current" height={36} title="" />
        <h1>{t('title')}</h1>
        <p className="auth-sub">{t(emailLoginEnabled() ? 'sub' : 'subGoogle')}</p>
        <GoogleButton label={t('google')} locale={locale} callbackUrl={callbackUrl} desktopHint={t('desktopHint')} />
        {emailLoginEnabled() && <EmailCodeForm locale={locale} callbackUrl={callbackUrl} />}
        <p className="auth-legal">
          {t.rich('legal', {
            terms: (chunks) => <a href={`/${locale}/terms`}>{chunks}</a>,
            privacy: (chunks) => <a href={`/${locale}/privacy`}>{chunks}</a>,
          })}
        </p>
      </div>
    </main>
  );
}
