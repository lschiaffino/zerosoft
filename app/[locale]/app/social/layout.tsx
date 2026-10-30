import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/social.css';

/** Social: su hoja de estilos y los textos de sus componentes cliente. */
export default async function SocialLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['social']}>
      {props.children}
    </ClientMessages>
  );
}
