import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { generationProjectId } from '@/lib/analytics/llm';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una generación que no existe o es de otro workspace responde 404 y no 200. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  if (!/^\d{1,15}$/.test(id) || !(await generationProjectId(Number(id), user.id))) notFound();
  return props.children;
}
