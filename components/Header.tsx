import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/session';
import HeaderClient from './HeaderClient';

export default async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.header' });
  const user = await getCurrentUser();

  return (
    <HeaderClient
      locale={locale}
      user={user ? { name: user.name, email: user.email, image: user.image } : null}
      labels={{
        products: t('products'),
        blog: t('blog'),
        docs: t('docs'),
        changelog: t('changelog'),
        github: t('github'),
        startFree: t('startFree'),
        menu: t('menu'),
        signIn: t('signIn'),
        dashboard: t('dashboard'),
        signOut: t('signOut'),
      }}
    />
  );
}
