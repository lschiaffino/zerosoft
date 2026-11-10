import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import BiBranch from '@/components/bi/BiBranch';
import { requireUser } from '@/lib/session';
import '@/styles/analytics.css';
import '@/styles/bi.css';

/** Analytics (tipo Metabase): preguntas y tableros en el sidebar y los textos de sus componentes. */
export default async function BiLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['bi']}>
      {props.children}
      <BiBranch />
    </ClientMessages>
  );
}
