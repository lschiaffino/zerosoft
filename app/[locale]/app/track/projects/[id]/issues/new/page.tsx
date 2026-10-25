import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * El formulario largo de issue ya no existe: se crea con el modal rápido
 * (los mismos campos en todos lados). Los links viejos abren el modal en el
 * proyecto, o el sub-issue en el detalle del padre.
 */
export default async function NewIssuePage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<{ parentId?: string }>;
}) {
  const { locale, id } = await props.params;
  const parentId = (await props.searchParams)?.parentId;
  if (parentId) redirect(`/${locale}/app/track/issues/${encodeURIComponent(parentId)}`);
  redirect(`/${locale}/app/track/team/${encodeURIComponent(id)}?newIssue=1`);
}
