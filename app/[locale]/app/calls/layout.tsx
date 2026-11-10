import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/calls.css';

/** Calls: biblioteca de llamadas grabadas, agenda del bot, deals y preguntas. */
export default async function CallsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['calls']}>
      {props.children}
    </ClientMessages>
  );
}
