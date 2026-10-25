import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import RecBranch from '@/components/rec/RecBranch';
import '@/styles/rec.css';

/** Rec: biblioteca, grabador y detalle. Las carpetas cuelgan del sidebar del shell. */
export default async function RecLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['rec']}>
      {props.children}
      <RecBranch />
    </ClientMessages>
  );
}
