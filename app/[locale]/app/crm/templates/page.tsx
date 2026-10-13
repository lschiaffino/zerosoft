import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { canManageOwned, listEmailTemplates } from '@/lib/crm-email';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import TemplatesView from '@/components/crm/TemplatesView';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const actor = { isAdmin: isWorkspaceAdmin(user), personId: realUserId(user) };
  const templates = await listEmailTemplates(user.id);
  // Contactos con email para la vista previa (los más recientes).
  const contacts = (await getDb()
    .prepare(
      `SELECT id, first_name, last_name, email FROM crm_contacts
       WHERE user_id = ? AND email != '' ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(user.id)) as Array<{ id: string; first_name: string; last_name: string; email: string }>;

  return (
    <div className="app-page">
      <TemplatesView
        title={t('templates.title')}
        rows={templates.map((x) => ({
          id: x.id,
          kind: x.kind,
          name: x.name,
          subject: x.subject,
          body: x.body,
          updated: formatDate(x.updated_at, locale),
          canManage: canManageOwned(actor, x.created_by),
        }))}
        contacts={contacts.map((c) => ({
          id: c.id,
          label: `${`${c.first_name} ${c.last_name}`.trim() || c.email}${c.first_name || c.last_name ? ` · ${c.email}` : ''}`,
        }))}
      />
    </div>
  );
}
