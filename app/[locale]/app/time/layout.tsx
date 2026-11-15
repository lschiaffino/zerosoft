import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/time.css';

/** Time: hoja de horas, proyectos, reportes y ajustes. */
export default async function TimeLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['time']}>
      {props.children}
    </ClientMessages>
  );
}
