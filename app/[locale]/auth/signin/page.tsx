import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import ZeroField from '@/components/ZeroField';
import GoogleButton from '@/components/auth/GoogleButton';

export const dynamic = 'force-dynamic';

export default async function SignInPage({ params: { locale } }: { params: { locale: string } }) {
  const user = await getCurrentUser();
  if (user) redirect(`/${locale}/app`);

  const t = await getTranslations({ locale, namespace: 'common.auth' });

  return (
    <main className="auth-page">
      <ZeroField align="center" sizeFactor={1.4} interactive={false} alpha={0.1} />
      <div className="auth-card">
        <span className="brand-zero" style={{ width: 44, height: 44, fontSize: 20 }}>0</span>
        <h1>{t('title')}</h1>
        <p className="auth-sub">{t('sub')}</p>
        <GoogleButton label={t('google')} locale={locale} />
        <p className="auth-sub" style={{ marginTop: 18, fontSize: 12, color: 'var(--dim)' }}>
          {t('why')}
        </p>
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
