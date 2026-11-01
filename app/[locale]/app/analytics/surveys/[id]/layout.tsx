import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una encuesta que no existe o es de otro workspace responde 404 y no 200. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  if (!(await recordProjectId('surveys', id, user.id))) notFound();
  return props.children;
}
