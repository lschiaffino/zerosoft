import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { getDb } from '@/lib/db';
import { listCustomFields } from '@/lib/crm';
import { getPlaybook, listPlaybookRuns } from '@/lib/crm-playbooks';
import { listMembers } from '@/lib/teams';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import PlaybookEditor from '@/components/crm/PlaybookEditor';

export const dynamic = 'force-dynamic';

/** Lo que el editor necesita de cada propiedad propia (tipo y opciones, para filtrar). */
function fieldView(f: { name: string; label: string; type: string; options: string }) {
  let options: string[] = [];
  try {
    const raw: unknown = JSON.parse(f.options || '[]');
    if (Array.isArray(raw)) options = raw.filter((o): o is string => typeof o === 'string');
  } catch {
    options = [];
  }
  return { name: f.name, label: f.label, type: f.type, options };
}

const HREF: Record<string, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };

export default async function PlaybookPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const playbook = await getPlaybook(user.id, id);
  if (!playbook) notFound();
  const [contactFields, companyFields, dealFields, runs, members] = await Promise.all([
    listCustomFields(user.id, 'contacts'),
    listCustomFields(user.id, 'companies'),
    listCustomFields(user.id, 'deals'),
    listPlaybookRuns(user.id, { playbookId: id, limit: 20 }),
    workspaceTeamId(user) ? listMembers(workspaceTeamId(user)!) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  // Nombre de cada registro donde se usó (si todavía existe).
  const db = getDb();
  const names = new Map<string, string>();
  for (const r of runs) {
    const key = `${r.entity}:${r.entity_id}`;
    if (names.has(key)) continue;
    const row =
      r.entity === 'contact'
        ? ((await db.prepare("SELECT trim(first_name || ' ' || last_name) AS n, email FROM crm_contacts WHERE id = ? AND user_id = ?").get(r.entity_id, user.id)) as
            | { n: string; email: string }
            | undefined)
        : ((await db.prepare(`SELECT name AS n, '' AS email FROM ${r.entity === 'company' ? 'crm_companies' : 'crm_deals'} WHERE id = ? AND user_id = ?`).get(r.entity_id, user.id)) as
            | { n: string; email: string }
            | undefined);
    names.set(key, row ? row.n || row.email : '');
  }
  const people = new Map(members.map((m) => [m.user_id, m.name || m.email]));
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/crm/playbooks', label: t('playbooks.back') }} title={playbook.name} description={t('playbooks.editorSub')} />
      <PlaybookEditor
        key={playbook.id}
        playbook={playbook}
        canEdit={isWorkspaceAdmin(user)}
        customFields={{
          contact: contactFields.map(fieldView),
          company: companyFields.map(fieldView),
          deal: dealFields.map(fieldView),
        }}
        runs={runs.map((r) => {
          const name = names.get(`${r.entity}:${r.entity_id}`) ?? '';
          return {
            id: r.id,
            when: formatDate(r.created_at, locale),
            recordName: name || t('playbooks.deletedRecord'),
            recordHref: name ? `/app/crm/${HREF[r.entity]}/${r.entity_id}` : null,
            actor: r.actor_id ? people.get(r.actor_id) ?? '' : '',
          };
        })}
      />
    </div>
  );
}
