import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Cycles de un team por su clave (/track/team/MOB/cycles), como Linear: la vista vive en /track/cycles?team=MOB. */
export default async function TeamCyclesPage(props: { params: Promise<{ locale: string; key: string }> }) {
  const { locale, key } = await props.params;
  redirect(`/${locale}/app/track/cycles?team=${encodeURIComponent(decodeURIComponent(key).toUpperCase())}`);
}
