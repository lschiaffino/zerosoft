import { notFound, redirect } from 'next/navigation';
import { legacyBookPath } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/**
 * Links viejos /book/<slug> (antes de los handles de usuario): redirige al
 * link nuevo /book/<handle>/<slug> conservando el pre-fill.
 */
export default async function LegacyBookPage(props: {
  params: Promise<{ handle: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle: slug, locale } = await props.params;
  const searchParams = await props.searchParams;
  const path = await legacyBookPath(slug);
  if (!path) notFound();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') qs.set(k, v);
  const suffix = qs.toString();
  redirect(`/${locale}${path}${suffix ? `?${suffix}` : ''}`);
}
