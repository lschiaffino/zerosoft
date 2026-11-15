import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { fleetActorOf } from '@/lib/fleet/api';
import { getSession } from '@/lib/fleet/sessions';
import { FleetError } from '@/lib/fleet/types';

/** Arriba de loading.tsx: una sección o una sesión desconocida responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('fleet', section) || !sectionTakesId('fleet', section, id) || zs.length > 2) notFound();
  if (section === 'chats' && id) {
    const actor = fleetActorOf(await requireUser(locale));
    try {
      await getSession(actor, id);
    } catch (err) {
      if (err instanceof FleetError) notFound();
      throw err;
    }
  }
  return props.children;
}
