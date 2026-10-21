import { requireUser } from '@/lib/session';
import { shortDomain } from '@/lib/utils';
import { listDomains } from '@/lib/link-domains';
import { listFolders, viewerOf } from '@/lib/link-folders';
import BulkCreateForm from '@/components/link/BulkCreateForm';
import NewLinkShell from '@/components/link/NewLinkShell';

export const dynamic = 'force-dynamic';

export default async function BulkPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [domains, folders] = await Promise.all([listDomains(user.id), listFolders(user.id, viewerOf(user))]);
  return (
    <NewLinkShell locale={locale}>
      <BulkCreateForm
        domain={shortDomain()}
        customDomains={domains.filter((d) => d.verified === 1).map((d) => ({ id: d.id, hostname: d.hostname }))}
        folders={folders.filter((f) => f.access === 'edit').map((f) => ({ id: f.id, name: f.name }))}
      />
    </NewLinkShell>
  );
}
