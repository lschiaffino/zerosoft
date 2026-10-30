import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listDesigns } from '@/lib/design';
import { designActorOf } from '@/lib/design-http';
import { DESIGN_TEMPLATES, templateDoc, templateName } from '@/lib/design-templates';
import DesignTemplates from '@/components/design/DesignTemplates';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'design.templates' });
  return { title: `${t('title')} · Design` };
}

/** Plantillas: las de la app (en JSON, sin assets de terceros) y las del workspace. */
export default async function DesignTemplatesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const workspace = await listDesigns(designActorOf(user), { view: 'templates', limit: 100 });
  const builtIn = DESIGN_TEMPLATES.map((t) => ({ id: t.id, preset: t.preset, name: templateName(t, locale), doc: templateDoc(t, locale) }));
  return <DesignTemplates builtIn={builtIn} workspace={workspace} />;
}
