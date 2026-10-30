import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/people.css';

/** People: directorio, organigrama, licencias, onboarding, evaluaciones y reportes. */
export default async function PeopleLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['people']}>
      {props.children}
    </ClientMessages>
  );
}
