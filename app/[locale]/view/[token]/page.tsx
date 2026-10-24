import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicDocument } from '@/lib/crm-media';
import DocViewer from '@/components/crm/DocViewer';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const doc = await getPublicDocument(token);
  const t = await getTranslations({ locale, namespace: 'crm.mediaPublic' });
  return { title: doc?.name ?? t('notFound'), robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/** Documento compartido con un link de seguimiento: se lee sin login y cada vista queda en el CRM. */
export default async function PublicDocumentPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const doc = await getPublicDocument(token);
  if (!doc) notFound();
  return (
    <main className="dv-main">
      <DocViewer token={token} name={doc.name} />
    </main>
  );
}
