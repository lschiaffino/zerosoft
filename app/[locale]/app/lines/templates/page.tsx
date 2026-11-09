import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listLabels, listNumbers } from '@/lib/groups';
import { listTemplates } from '@/lib/groups-org';
import PageHeader from '@/components/ui/PageHeader';
import TemplatesBoard from '@/components/groups/TemplatesBoard';

export const dynamic = 'force-dynamic';

/** Plantillas de grupo: miembros y admins fijos, nombre con variables, ajustes y bienvenida. */
export default async function GroupsTemplatesPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ new?: string; use?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const [templates, numbers, labels] = await Promise.all([listTemplates(user.id), listNumbers(user.id), listLabels(user.id)]);
  return (
    <div className="ui-page">
      <PageHeader title={t('templates.title')} description={t('templates.desc')} />
      <TemplatesBoard
        initial={templates}
        numbers={numbers}
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        openNew={sp.new === '1'}
        useId={sp.use ?? null}
      />
    </div>
  );
}
