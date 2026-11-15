import { getTranslations } from 'next-intl/server';
import { getDb } from '@/lib/db';
import { listInboxContacts } from '@/lib/inbox/contacts';
import { inboxHubspotScope } from '@/lib/inbox/contacts-http';
import PageHeader from '@/components/ui/PageHeader';
import ContactsView from '@/components/groups/wa/ContactsView';
import '@/styles/lines-groups-table.css';
import '@/styles/wa-contacts.css';

/**
 * Inbox › Contactos (/app/inbox/contacts): las personas de los WhatsApp de la
 * persona, una vez cada una, con sus cuentas, grupos, último mensaje y su
 * contacto de HubSpot (el del workspace, como en Lines).
 */
export default async function InboxContacts({ locale, owner }: { locale: string; owner: string }) {
  const t = await getTranslations({ locale, namespace: 'inboxWa.contacts' });
  const scope = await inboxHubspotScope();
  const [accounts, initial] = await Promise.all([
    getDb().prepare("SELECT id, label, address FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp' ORDER BY created_at").all(owner) as Promise<
      Array<{ id: string; label: string; address: string }>
    >,
    listInboxContacts(owner, scope),
  ]);
  return (
    <div className="ui-page">
      <PageHeader title={t('title')} description={t('descInbox')} />
      <ContactsView
        app="inbox"
        initial={initial}
        lines={accounts.map((a) => ({ id: a.id, name: a.label || (a.address ? `+${a.address.replace(/\D/g, '')}` : a.id) }))}
        canWrite={scope !== null}
      />
    </div>
  );
}
