import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { getEmployee } from '@/lib/people';
import { sessionCtx } from '@/lib/people-http';
import { getCycle } from '@/lib/people-perf';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('people', section) || !sectionTakesId('people', section, id)) notFound();
  const profile = section?.startsWith('emp_');
  if (profile || (section === 'reviews' && id)) {
    const ctx = await sessionCtx(await requireUser(locale));
    if (profile && !(await getEmployee(ctx, section as string, { audit: false }))) notFound();
    if (section === 'reviews' && id && !(await getCycle(ctx, id))) notFound();
  }
  return props.children;
}
