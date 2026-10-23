import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Herramientas gratis: los textos de cada herramienta. */
export default async function ToolLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['tools']}>
      {props.children}
    </ClientMessages>
  );
}
