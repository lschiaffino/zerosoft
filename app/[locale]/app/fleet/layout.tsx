import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/fleet.css';

/** Fleet: tablero de los agentes de código, chats con ellos, PRs y deploys. */
export default async function FleetLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['fleet']}>
      {props.children}
    </ClientMessages>
  );
}
