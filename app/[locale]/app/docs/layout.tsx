import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import DocsAskPanel from '@/components/docs/DocsAskPanel';
import DocsPwa from '@/components/docs/DocsPwa';
import '@/styles/docs.css';
import '@/styles/docs-platform.css';

/** Docs: su hoja de estilos y los textos de sus componentes cliente. */
export default async function DocsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['docs']}>
      {props.children}
      <DocsPwa />
      {/* "Ask AI": preguntas sobre todo el workspace (banda, sidebar ?ask=1 y ⌘K). */}
      <Suspense fallback={null}>
        <DocsAskPanel />
      </Suspense>
    </ClientMessages>
  );
}
