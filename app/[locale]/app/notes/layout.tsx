import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/docs.css';
import '@/styles/notes.css';

/** Notes usa el editor de bloques de Docs: trae su hoja y sus textos además de los propios. */
export default async function NotesLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['notes', 'docs']}>
      {props.children}
    </ClientMessages>
  );
}
