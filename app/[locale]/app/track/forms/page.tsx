import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { parseFormFields } from '@/lib/track-forms';
import { listWorkspaceFormTemplates } from '@/lib/track-templates';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/** Track › Formularios: los formularios de pedidos de los teams que la persona ve. */
export default async function TrackFormsIndex(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const all = await listWorkspaceFormTemplates(user.team?.id ?? null, user.id);
  const visible = new Map<string, boolean>();
  const rows = [];
  for (const tpl of all) {
    if (!visible.has(tpl.project_id)) {
      const project = await getProject(tpl.project_id);
      visible.set(tpl.project_id, Boolean(project && (await canAccessTrackProject(project, user.team?.id ?? null, user.id))));
    }
    if (visible.get(tpl.project_id)) rows.push(tpl);
  }
  return (
    <div className="app-page track-page">
      <PageHeader title={t('forms.indexTitle')} description={t('forms.indexDesc')} />
      {rows.length === 0 ? (
        <EmptyState title={t('forms.indexEmptyTitle')} body={t('forms.indexEmptyBody')} />
      ) : (
        <ul className="track-forms-index" data-testid="track-forms-index">
          {rows.map((tpl) => (
            <li key={tpl.id} className="track-forms-index-row">
              <Link href={`/app/track/forms/${tpl.id}`} className="track-forms-index-link" data-testid="track-forms-index-item">
                <span className="track-forms-index-name">{tpl.name}</span>
                <span className="track-forms-index-meta">
                  {tpl.team_name} · {t('forms.kind', { count: parseFormFields(tpl.fields).length })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
