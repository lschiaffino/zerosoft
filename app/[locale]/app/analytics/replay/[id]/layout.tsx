import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';
import { roleAtLeast } from '@/lib/teams';

/** Arriba de loading.tsx: una grabación que no existe o es de otro workspace responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  // Ver grabaciones es de admins, y arriba de loading.tsx para que el 404 sea de verdad.
  if (!roleAtLeast(user.role, 'admin') || !(await recordProjectId('recordings', id, user.id))) notFound();
  return props.children;
}
