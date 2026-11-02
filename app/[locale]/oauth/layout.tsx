import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Pantallas de permisos de OAuth: sus textos para los componentes de cliente. */
export default async function OAuthLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['settings.oauth']}>
      {props.children}
    </ClientMessages>
  );
}
