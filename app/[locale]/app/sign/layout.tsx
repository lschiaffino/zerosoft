import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/sign.css';
import '@/styles/esign.css';

/** Sign: sobres, plantillas y envío masivo. */
export default async function SignLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['sign']}>
      {props.children}
    </ClientMessages>
  );
}
