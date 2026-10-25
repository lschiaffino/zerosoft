import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** "Plans" pasó a llamarse Projects, como en Linear. */
export default async function Page(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries((await props.searchParams) ?? {})) if (typeof v === 'string') sp.set(k, v);
  redirect(`/${locale}/app/track/projects${sp.size ? `?${sp}` : ''}`);
}
