import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** El alta de team (antes "proyecto") vive en /app/track/teams/new. */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/app/track/teams/new`);
}
