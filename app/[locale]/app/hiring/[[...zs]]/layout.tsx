import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection } from '@/lib/app-sections';

/** Arriba de loading.tsx: una sección desconocida responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ zs?: string[] }> }) {
  const { zs = [] } = await props.params;
  if (!isAppSection('hiring', zs[0])) notFound();
  return props.children;
}
