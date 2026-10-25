import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import ProjectForm from '@/components/track/ProjectForm';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <div className="app-page track-page ui-page ui-page-narrow">
      <PageHeader title={t('projects.newTitle')} back={{ href: '/app/track/teams', label: t('projects.title') }} />
      <ProjectForm />
    </div>
  );
}
