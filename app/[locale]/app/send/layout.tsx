import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/send.css';

/** Send: documentos, links, espacios y quién leyó qué. */
export default async function SendLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['send']}>
      {props.children}
    </ClientMessages>
  );
}
