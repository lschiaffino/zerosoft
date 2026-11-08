import { getTranslations } from 'next-intl/server';
import HeaderClient from './HeaderClient';
import '@/styles/site.css';

export default async function Header({ locale }: { locale: string }) {
  // Sin sesión acá: el header va en el HTML estático del sitio. HeaderClient
  // sabe si hay alguien logueado por la cookie zs_who (ver lib/session-hint.ts).
  const t = await getTranslations({ locale, namespace: 'common.header' });

  return (
    <HeaderClient
      locale={locale}
      labels={{
        products: t('products'),
        blog: t('blog'),
        docs: t('docs'),
        freeTools: t('freeTools'),
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
