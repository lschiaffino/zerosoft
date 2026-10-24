import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Link con contraseña: solo los textos del formulario. */
export default async function LinkGateLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['link.gate']}>
      {props.children}
    </ClientMessages>
  );
}
