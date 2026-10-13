import { notFound, redirect } from 'next/navigation';
import { legacyRoutingPath } from '@/lib/calendar-routing';

export const dynamic = 'force-dynamic';

/** Links viejos /r/<slug>: redirige a /r/<handle>/<slug>. */
export default async function LegacyRoutingPage(props: { params: Promise<{ handle: string; locale: string }> }) {
  const { handle: slug, locale } = await props.params;
  const path = await legacyRoutingPath(slug);
  if (!path) notFound();
  redirect(`/${locale}${path}`);
}
