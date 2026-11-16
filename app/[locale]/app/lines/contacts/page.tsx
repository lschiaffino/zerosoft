import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listNumbers } from '@/lib/groups';
import { listLinesContacts } from '@/lib/groups-contacts';
import { pageViewer } from '@/lib/groups-page';
import PageHeader from '@/components/ui/PageHeader';
import ContactsView from '@/components/groups/wa/ContactsView';
import '@/styles/wa-contacts.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'inboxWa.contacts' });
  return { title: `${t('title')} · Lines` };
}

/**
 * Lines › Contactos: cada persona de las líneas que quien mira ve, una sola
 * vez (teléfono y lid unidos), con sus líneas, grupos, último mensaje y su
 * contacto y empresa de HubSpot (lib/groups-contacts.ts).
 */
export default async function LinesContactsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'inboxWa.contacts' });
  const viewer = await pageViewer(user);
  const [numbers, initial] = await Promise.all([listNumbers(user.id, viewer), listLinesContacts(viewer)]);
  return (
    <div className="ui-page">
      <PageHeader title={t('title')} description={t('descLines')} />
      <ContactsView
        app="lines"
        initial={initial}
        lines={numbers.map((n) => ({ id: n.id, name: n.name || (n.phone ? `+${n.phone}` : n.id) }))}
        canWrite={user.role !== 'guest'}
      />
    </div>
  );
}
