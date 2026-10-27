import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';
import { getRoutingForm, listRoutingSubmissions, loadRoutingFunnel } from '@/lib/calendar-routing';
import RoutingFunnelView from '@/components/calendar/RoutingFunnelView';
import PageHeader from '@/components/ui/PageHeader';
import RoutingFormEditor from '@/components/calendar/RoutingFormEditor';
import CalDeleteButton from '@/components/calendar/CalDeleteButton';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function RoutingFormDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const form = await getRoutingForm(user.id, id);
  if (!form) notFound();
  const eventTypes = await listEventTypes(user.id);
  const submissions = (await listRoutingSubmissions(user.id, id, 50)) ?? [];
  const origin = publicOrigin((await headers()).get('host'));
  const funnel = await loadRoutingFunnel(user.id, id);
  // Nombre de cada regla para el embudo: "Regla 2 · tamaño es 50+".
  const ruleLabels = Object.fromEntries(
    form.rules.map((r, i) => {
      const field = form.fields.find((f) => f.id === r.field_id);
      return [r.id, `${t('funnel.rule', { n: i + 1 })} · ${field?.label ?? ''} ${r.operator === 'truthy' ? '' : r.value}`.trim()];
    }),
  );

  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/calendar/routing', label: t('routing.title') }}
        title={
          <span className="cal-title-row">
            {form.title}
            {!form.active && <span className="badge">{t('routing.inactive')}</span>}
          </span>
        }
        description={t('routing.editorLead')}
        actions={
          <CalDeleteButton
            url={`/api/calendar/routing/${id}`}
            confirmText={t('routing.deleteConfirm', { title: form.title })}
            redirectTo="/app/calendar/routing"
          />
        }
      />
      <RoutingFormEditor
        initial={form}
        submissions={submissions}
        locale={locale}
        publicBase={`${origin}/${locale}/r/${user.handle ?? ''}/`}
        eventTypes={eventTypes.map((et) => ({ id: et.id, title: et.title, slug: et.slug }))}
      />
      {funnel && <RoutingFunnelView funnel={funnel} locale={locale} ruleLabels={ruleLabels} />}
    </div>
  );
}
