import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/docs.css';
import '@/styles/talk.css';
import '@/styles/talk-parity.css';

export default async function TalkLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['talk', 'docs']}>
      {props.children}
    </ClientMessages>
  );
}
