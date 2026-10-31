import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { actorOf } from '@/lib/forms/http';
import { getForm } from '@/lib/forms/core';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un formulario que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const section = zs[0];
  if (section && section !== 'new' && section !== 'settings') {
    const user = await requireUser(locale);
    if (user.role !== 'guest' && !(await getForm(actorOf(user), section))) notFound();
  }
  return props.children;
}
