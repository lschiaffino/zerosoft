import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Centro de ayuda: la valoración de artículos y el embed de pizarras de Docs. */
export default async function HelpCenterLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['docs.help', 'docs.editor.board', 'docs.editor.design']}>
      {props.children}
    </ClientMessages>
  );
}
