import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/voice.css';

/** Voice: su hoja de estilos y los textos de sus componentes cliente. */
export default async function VoiceLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['voice']}>
      {props.children}
    </ClientMessages>
  );
}
