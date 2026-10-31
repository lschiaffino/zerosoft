import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/rec-http';
import { getSpace } from '@/lib/rec-admin';

/** Antes del loading de la página: un espacio ajeno o inexistente responde 404 de verdad. Solo lee. */
export default async function RecSpaceLayout(props: { children: ReactNode; params: Promise<{ locale: string; spaceId: string }> }) {
  const { locale, spaceId } = await props.params;
  const user = await requireUser(locale);
  if (!(await getSpace(actorOf(user), spaceId))) notFound();
  return props.children;
}
