import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getPoll } from '@/lib/calendar-polls';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  if (!(await getPoll(user.id, id))) notFound();
  return props.children;
}
