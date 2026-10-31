import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getCompany } from '@/lib/crm';
import { canSeeOwner, sessionScope } from '@/lib/crm-visibility';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un registro que no existe o no se puede ver responde 404 y no 200. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const row = await getCompany(user.id, id);
  if (!row || !canSeeOwner(scope, row.company.owner_id, user.id)) notFound();
  return props.children;
}
