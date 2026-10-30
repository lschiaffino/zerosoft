import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/forms-app.css';
import '@/styles/forms-runner.css';

/** Forms: formularios, respuestas, resumen y ajustes. */
export default async function FormsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['forms']}>
      {props.children}
    </ClientMessages>
  );
}
