import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { actorOf } from '@/lib/forms/http';
import { getForm } from '@/lib/forms/core';
import { getResponse } from '@/lib/forms/responses';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un formulario que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, sub, rid] = zs;
  if (zs.length > 3) notFound();
  if (section === 'new' || section === 'settings') {
    if (sub) notFound();
  } else if (section) {
    if (sub && !['share', 'responses', 'summary'].includes(sub)) notFound();
    if (rid && sub !== 'responses') notFound();
    const user = await requireUser(locale);
    if (user.role !== 'guest') {
      const actor = actorOf(user);
      if (!(await getForm(actor, section))) notFound();
      if (rid && !(await getResponse(actor, section, rid))) notFound();
    }
  }
  return props.children;
}
