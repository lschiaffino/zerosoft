import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { resolveDocAccess } from '@/lib/docs';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una página que no existe o no se puede ver responde 404 y no 200. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  if (!(await resolveDocAccess(user, id))) notFound();
  return props.children;
}
