import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/hiring.css';

/** Hiring: puestos, pipeline, candidatos, scorecards, entrevistas y ofertas. */
export default async function HiringLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['hiring']}>
      {props.children}
    </ClientMessages>
  );
}
