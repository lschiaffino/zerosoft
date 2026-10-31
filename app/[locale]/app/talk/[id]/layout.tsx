import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { resolveTalkChannelRoute } from '@/lib/talk-guests';

/**
 * Arriba de loading.tsx: un canal que no existe o que la persona no puede leer
 * responde 404 y no 200 (ver lib/app-sections.ts). Uno de otro workspace de
 * Talk suyo pasa: la página cambia a ese workspace.
 */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const route = await resolveTalkChannelRoute(await requireUser(locale), id);
  if (route.kind === 'missing') notFound();
  return props.children;
}
