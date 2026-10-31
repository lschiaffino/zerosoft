import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getRoutingForm } from '@/lib/calendar-routing';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  if (!(await getRoutingForm((await requireUser(locale)).id, id))) notFound();
  return props.children;
}
