import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  if (!(await getDb().prepare('SELECT 1 AS x FROM analytics_flags WHERE id = ?').get(id))) notFound();
  return props.children;
}
