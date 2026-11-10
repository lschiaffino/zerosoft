import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { getCallRow } from '@/lib/calls/core';
import { callsActorOf } from '@/lib/calls/actor';
import { CallsError } from '@/lib/calls/types';

/** Arriba de loading.tsx: una sección o una llamada desconocida responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('calls', section) || !sectionTakesId('calls', section, id) || zs.length > 2) notFound();
  if (section === 'call') {
    if (!id) notFound();
    const actor = callsActorOf(await requireUser(locale));
    try {
      await getCallRow(actor, id);
    } catch (err) {
      if (err instanceof CallsError) notFound();
      throw err;
    }
  }
  return props.children;
}
