import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Invitación a un workspace: solo sus textos. */
export default async function InviteLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['settings.invite']}>
      {props.children}
    </ClientMessages>
  );
}
