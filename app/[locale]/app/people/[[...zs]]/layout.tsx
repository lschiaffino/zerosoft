import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { employeeIdForUser, getEmployee } from '@/lib/people';
import { getTemplate } from '@/lib/people-onboarding';
import { sessionCtx } from '@/lib/people-http';
import { getCycle } from '@/lib/people-perf';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id, sub] = zs;
  if (zs.length > 3 || !isAppSection('people', section) || !sectionTakesId('people', section, id)) notFound();
  const profile = section?.startsWith('emp_');
  if (section === 'onboarding' && id && (id !== 'templates' || !sub)) notFound();
  if ((section === 'u' && (!id || sub)) || (section === 'reviews' && sub) || (profile && id)) notFound();
  if (profile || section === 'u' || (section === 'reviews' && id) || (section === 'onboarding' && id)) {
    const ctx = await sessionCtx(await requireUser(locale));
    if (section === 'u') {
      const employee = await employeeIdForUser(ctx.ws, id as string);
      if (!employee) notFound();
      redirect(`/${locale}/app/people/${employee}`);
    }
    // Quien no es de RR. HH. ve el aviso de la página, exista o no la plantilla.
    if (section === 'onboarding' && ctx.viewer.hr && !(await getTemplate(ctx.ws, sub as string))) notFound();
    if (profile && !(await getEmployee(ctx, section as string, { audit: false }))) notFound();
    if (section === 'reviews' && id && !(await getCycle(ctx, id))) notFound();
  }
  return props.children;
}
