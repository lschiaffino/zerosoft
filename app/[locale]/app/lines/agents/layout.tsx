import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/fleet.css';

/** Lines › Agentes: los chats con los agentes de Fleet dentro de Lines. */
export default async function LinesAgentsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['fleet']}>
      {props.children}
    </ClientMessages>
  );
}
