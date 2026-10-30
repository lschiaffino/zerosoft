import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { userCanUseApp } from '@/lib/workspace';
import { actorOf } from '@/lib/forms/http';
import { getForm, listForms, workspaceDefaults } from '@/lib/forms/core';
import { formSummary, getResponse, listResponses } from '@/lib/forms/responses';
import { TEMPLATES } from '@/lib/forms/templates';
import { getBrandKit } from '@/lib/design';
import EmptyState from '@/components/ui/EmptyState';
import FormsList from '@/components/forms/FormsList';
import FormNew from '@/components/forms/FormNew';
import FormBuilder from '@/components/forms/FormBuilder';
import FormResponses from '@/components/forms/FormResponses';
import ResponseDetail from '@/components/forms/ResponseDetail';
import FormSummaryView from '@/components/forms/FormSummary';
import FormsSettings from '@/components/forms/FormsSettings';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; zs?: string[] }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, zs = [] } = await props.params;
  const t = await getTranslations({ locale, namespace: 'forms' });
  if (zs[0] === 'new') return { title: `${t('nav.templates')} · Forms` };
  if (zs[0] === 'settings') return { title: `${t('settings.title')} · Forms` };
  return { title: t('meta.title') };
}

/**
 * Forms en una sola ruta (presupuesto de rutas): /app/forms (lista), /new
 * (plantillas), /settings, /<form> (builder; ?tab=), /<form>/responses,
 * /<form>/responses/<respuesta>, /<form>/summary y /<form>/share.
 */
export default async function FormsPage(props: Props) {
  const { locale, zs = [] } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'forms' });
  if (user.role === 'guest') return <EmptyState product="forms" title={t('guest.title')} body={t('guest.body')} />;
  const actor = actorOf(user);
  const [section, sub, rid] = zs;
  if (zs.length > 3) notFound();

  if (!section) {
    const forms = await listForms(actor, { q: sp.q ?? '', status: sp.status ?? '' });
    return <FormsList forms={forms} q={sp.q ?? ''} status={sp.status ?? ''} />;
  }
  if (section === 'new') {
    if (sub) notFound();
    return <FormNew templates={TEMPLATES} locale={locale} />;
  }
  if (section === 'settings') {
    if (sub) notFound();
    return <FormsSettings defaults={await workspaceDefaults(actor.ws)} admin={actor.admin} />;
  }

  const form = await getForm(actor, section);
  if (!form) notFound();
  const crmApp = userCanUseApp(user, 'crm');
  switch (sub) {
    case undefined:
    case 'share':
      if (rid) notFound();
      return (
        <FormBuilder
          key={sub ?? 'build'}
          initial={form}
          tab={sub === 'share' ? 'share' : (sp.tab ?? 'build')}
          me={actor.person}
          admin={actor.admin}
          crmApp={crmApp}
          brandColors={(await getBrandKit(actor.ws).catch(() => null))?.colors ?? []}
        />
      );
    case 'responses': {
      if (rid) {
        const response = await getResponse(actor, form.id, rid);
        if (!response) notFound();
        return <ResponseDetail form={form} response={response} />;
      }
      const filters = { status: (sp.status === 'partial' ? 'partial' : 'completed') as 'partial' | 'completed', q: sp.q ?? '', from: sp.from ?? '', to: sp.to ?? '', question: sp.question ?? '', value: sp.value ?? '', page: Number(sp.page) || 1, pageSize: 50 };
      const res = await listResponses(actor, form.id, filters);
      return <FormResponses form={form} rows={res?.rows ?? []} total={res?.total ?? 0} filters={filters} />;
    }
    case 'summary': {
      if (rid) notFound();
      const tp = await getTranslations({ locale, namespace: 'forms.public' });
      const summary = await formSummary(actor, form.id, { yes: tp('yes'), no: tp('no'), file: tp('file'), signed: tp('signed') });
      return <FormSummaryView form={form} summary={summary!} />;
    }
    default:
      notFound();
  }
}
