import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import InboxBranch from '@/components/inbox/InboxBranch';
import { requireUser } from '@/lib/session';
import '@/styles/inbox.css';
import '@/styles/inbox-tools.css';

/** Inbox (personal): WhatsApp y Gmail de la persona. Las carpetas cuelgan del sidebar del shell. */
export default async function InboxLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['inbox']}>
      {props.children}
      <InboxBranch />
    </ClientMessages>
  );
}
