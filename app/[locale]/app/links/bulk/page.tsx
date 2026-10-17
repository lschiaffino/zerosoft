import { requireUser } from '@/lib/session';
import BulkCreateForm from '@/components/link/BulkCreateForm';
import NewLinkShell from '@/components/link/NewLinkShell';

export const dynamic = 'force-dynamic';

export default async function BulkPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <NewLinkShell locale={locale}>
      <BulkCreateForm />
    </NewLinkShell>
  );
}
