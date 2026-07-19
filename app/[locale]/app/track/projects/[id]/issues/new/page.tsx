import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getProject, listCycles, listStatuses } from '@/lib/track-data';
import IssueForm from '@/components/track/IssueForm';

export const dynamic = 'force-dynamic';

export default async function NewIssuePage({
  params: { locale, id },
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams?: { parentId?: string };
}) {
  const user = await requireUser(locale);
  const project = await getProject(id);
  if (!project || project.team_id !== (user.team?.id ?? null)) notFound();

  const t = await getTranslations({ locale, namespace: 'track' });
  const statuses = await listStatuses(id);
  const cycles = await listCycles(id);

  return (
    <div className="app-page track-page">
      <h1 className="app-title">{t('issues.newTitle')}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        {t('issues.newSub')}
      </p>

      <IssueForm
        locale={locale}
        projectId={id}
        parentId={searchParams?.parentId}
        statuses={statuses}
        cycles={cycles}
        labels={{
          title: t('issues.form.title'),
          titlePlaceholder: t('issues.form.titlePlaceholder'),
          description: t('issues.form.description'),
          status: t('issues.form.status'),
          priority: t('issues.form.priority'),
          assignee: t('issues.form.assignee'),
          cycle: t('issues.form.cycle'),
          estimate: t('issues.form.estimate'),
          dueDate: t('issues.form.dueDate'),
          labels: t('issues.form.labels'),
          create: t('common.create'),
          saving: t('common.saving'),
          cancel: t('common.cancel'),
          genericError: t('errors.generic'),
        }}
        priorities={[
          { value: 'urgent', label: t('priorities.urgent') },
          { value: 'high', label: t('priorities.high') },
          { value: 'medium', label: t('priorities.medium') },
          { value: 'low', label: t('priorities.low') },
        ]}
      />
    </div>
  );
}
