import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { parseFormFields } from '@/lib/track-forms';
import { getTemplate } from '@/lib/track-templates';
import RequestForm from '@/components/track/RequestForm';

export const dynamic = 'force-dynamic';

/** Un formulario de pedidos de un team (form template de Linear): crea un issue en su triage. */
export default async function TrackFormPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const template = await getTemplate(id);
  const project = template ? await getProject(template.project_id) : undefined;
  if (!template || !project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) notFound();
  const fields = parseFormFields(template.fields);
  if (fields.length === 0) notFound();
  return (
    <div className="app-page track-page">
      <RequestForm
        templateId={template.id}
        name={template.name}
        instructions={template.description}
        titlePrefix={template.title}
        fields={fields}
        team={{ name: project.name, key: project.slug.toUpperCase(), triage: project.triage_enabled === 1 }}
      />
    </div>
  );
}
