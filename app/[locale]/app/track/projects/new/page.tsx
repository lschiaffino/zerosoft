import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import ProjectForm from '@/components/track/ProjectForm';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <div className="app-page track-page">
      <h1 className="app-title">{t('projects.newTitle')}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        {t('projects.newSub')}
      </p>

      <ProjectForm
        locale={locale}
        labels={{
          name: t('projects.form.name'),
          namePlaceholder: t('projects.form.namePlaceholder'),
          slug: t('projects.form.slug'),
          slugPlaceholder: t('projects.form.slugPlaceholder'),
          description: t('projects.form.description'),
          icon: t('projects.form.icon'),
          color: t('projects.form.color'),
          create: t('common.create'),
          cancel: t('common.cancel'),
          saving: t('common.saving'),
          genericError: t('errors.generic'),
        }}
      />
    </div>
  );
}
