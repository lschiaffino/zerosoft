import { requireUser } from '@/lib/session';
import { shortDomain } from '@/lib/utils';
import NewLinkForm from '@/components/link/NewLinkForm';
import NewLinkShell from '@/components/link/NewLinkShell';
import { listDomains } from '@/lib/link-domains';

export const dynamic = 'force-dynamic';

export default async function NewLinkPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const searchParams = await props.searchParams;

  const user = await requireUser(locale);
  const customDomains = (await listDomains(user.id))
    .filter((d) => d.verified === 1)
    .map((d) => ({ id: d.id, hostname: d.hostname }));
  const initialUrl = typeof searchParams.url === 'string' ? searchParams.url.slice(0, 2000) : '';

  return (
    <NewLinkShell locale={locale}>
      <NewLinkForm domain={shortDomain()} customDomains={customDomains} initialUrl={initialUrl} />
    </NewLinkShell>
  );
}
