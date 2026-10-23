import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
// El CSS de xyflow va antes que flow.css, que pisa algunas de sus reglas.
import '@xyflow/react/dist/style.css';
import '@/styles/flow.css';

/** Flow: el CSS del editor (xyflow) y el propio, y los textos de sus componentes cliente. */
export default async function FlowLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['flow']}>
      {props.children}
    </ClientMessages>
  );
}
