import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getPublicForm, toPublicForm } from '@/lib/crm-forms';
import { definitionOf, getPublicFormRow, openState, settingsOf } from '@/lib/forms/core';
import { hiddenFrom, localize, pickLang } from '@/lib/forms/engine';
import PublicForm from '@/components/crm/PublicForm';
import FormRunner from '@/components/forms/FormRunner';
import '@/styles/forms.css';
import '@/styles/forms-runner.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; zs: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** /f/<key>: primero los formularios del CRM (links de antes), después los de la app Forms. Comparten el espacio de slugs. */
async function resolve(zs: string[]) {
  if (zs.length !== 1) return null;
  const key = zs[0];
  const crm = await getPublicForm(key);
  if (crm) return { kind: 'crm' as const, crm };
  const row = await getPublicFormRow(key);
  return row ? { kind: 'forms' as const, row } : null;
}

export async function generateMetadata(props: Props) {
  const { locale, zs } = await props.params;
  const found = await resolve(zs);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const title = !found ? t('formsPublic.notFound') : found.kind === 'crm' ? found.crm.settings.title || found.crm.name : found.row.name;
  return { title, robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
}

/**
 * Formulario público: página propia o embebido (?embed=1, también en popup)
 * con el script de embed. Forms elige el idioma del formulario (el de la URL
 * si el form lo tiene; si no, su idioma base) y lee los campos ocultos de la
 * URL.
 */
export default async function PublicFormPage(props: Props) {
  const { locale, zs } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const found = await resolve(zs);
  if (!found) notFound();
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
  const embed = one(sp.embed) === '1';

  if (found.kind === 'crm') {
    const form = found.crm;
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
    return (
      <main className={`fp${embed ? ' fp-embed' : ''}`}>
        <PublicForm form={toPublicForm(form)} embed={embed} urlParams={urlParams} pageUrl={one(sp.page_url).slice(0, 1500)} referrer={one(sp.ref).slice(0, 500)} />
      </main>
    );
  }

  const { row } = found;
  const def = definitionOf(row);
  const lang = pickLang(def, locale);
  if (lang !== locale) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') qs.set(k, v);
    redirect(`/${lang}/f/${row.slug}${qs.size ? `?${qs}` : ''}`);
  }
  const settings = settingsOf(row);
  return (
    <div className={`fr-page${embed ? ' fr-page-embed' : ''}`} style={{ background: settings.theme.background }}>
      <FormRunner
        slug={row.slug}
        definition={localize(def, lang)}
        settings={{ mode: settings.mode, theme: settings.theme, progressBar: settings.progressBar, resume: settings.resume, partials: settings.partials, closedMessage: settings.closedMessage }}
        closedReason={openState(row, settings)}
        hidden={hiddenFrom(def, sp)}
        lang={lang}
        languages={[def.lang, ...def.languages.filter((l) => l !== def.lang)]}
        embed={embed}
      />
    </div>
  );
}
