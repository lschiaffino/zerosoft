import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** La portada de Groups es la bandeja. */
export default async function GroupsHome(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/app/groups/inbox`);
}
