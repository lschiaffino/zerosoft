import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { RETURN_PATH_HEADER } from '@/lib/return-path';
import { requireUser } from '@/lib/session';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { requireSee } from '@/lib/sign/core';
import { signActorOf } from '@/lib/sign/http';
import { getTemplate } from '@/lib/sign/templates';
import { SignError } from '@/lib/sign/types';

async function exists(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch (err) {
    if (err instanceof SignError) return false;
    throw err;
  }
}

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('sign', section) || !sectionTakesId('sign', section, id)) notFound();
  if (id) {
    const actor = signActorOf(await requireUser(locale));
    // Desde el adjunto de un deal del CRM la página muestra un aviso en lugar del 404.
    const fromCrm = ((await headers()).get(RETURN_PATH_HEADER) ?? '').includes('from=crm');
    if (section === 'envelopes' && !fromCrm && !(await exists(() => requireSee(actor, id)))) notFound();
    if (section === 'templates' && !(await exists(() => getTemplate(actor, id)))) notFound();
  }
  return props.children;
}
