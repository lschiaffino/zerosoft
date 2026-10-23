import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Ajustes del CRM: las etiquetas usan el selector y los textos de Track. */
export default async function CrmSettingsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['track.bulk', 'track.issues', 'track.labelsSettings']}>
      {props.children}
    </ClientMessages>
  );
}
