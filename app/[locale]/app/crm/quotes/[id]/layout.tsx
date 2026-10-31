import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { canSeeQuote, sessionScope } from '@/lib/crm-visibility';
import { getQuote } from '@/lib/crm-products';
import { requireUser } from '@/lib/session';

/** Arriba de loading.tsx: un registro que no existe responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const quote = await getQuote(user.id, id);
  if (!quote || !(await canSeeQuote(user.id, quote.id, await sessionScope(user)))) notFound();
  return props.children;
}
