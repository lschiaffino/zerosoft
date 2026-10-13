import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicForm, toPublicForm } from '@/lib/crm-forms';
import PublicForm from '@/components/crm/PublicForm';
import '@/styles/forms.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(props: Props) {
  const { locale, key } = await props.params;
  const form = await getPublicForm(key);
  const t = await getTranslations({ locale, namespace: 'crm' });
  return {
    title: form ? form.settings.title || form.name : t('formsPublic.notFound'),
    robots: { index: false, follow: false },
  };
}

/** Formulario público del CRM: página propia o embebido (?embed=1) con el script de embed. */
export default async function PublicFormPage(props: Props) {
  const { locale, key } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const form = await getPublicForm(key);
  if (!form) notFound();
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
  const urlParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (/^(utm_[a-z]+|gclid|fbclid)$/.test(k) && typeof v === 'string') urlParams[k] = v.slice(0, 300);
  }
  // Campos ocultos con un parámetro de URL propio (no UTM) también se capturan.
  for (const f of form.fields) {
    if (f.type === 'hidden' && f.urlParam && typeof sp[f.urlParam] === 'string') {
      urlParams[f.urlParam] = (sp[f.urlParam] as string).slice(0, 300);
    }
  }
  const embed = one(sp.embed) === '1';
  return (
    <main className={`fp${embed ? ' fp-embed' : ''}`}>
      <PublicForm
        form={toPublicForm(form)}
        embed={embed}
        urlParams={urlParams}
        pageUrl={one(sp.page_url).slice(0, 1500)}
        referrer={one(sp.ref).slice(0, 500)}
      />
    </main>
  );
}
