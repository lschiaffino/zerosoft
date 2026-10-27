import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { publicForm } from '@/lib/flow';
import HostedForm from '@/components/flow/HostedForm';
import '@/styles/flow-approval.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const t = await getTranslations({ locale, namespace: 'flow' });
  const form = /^fh_[A-Za-z0-9_-]{20,64}$/.test(token) ? await publicForm(token) : null;
  return {
    title: form?.title || t('formPage.title'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  };
}

/**
 * Formulario hospedado de un flow (trigger.form): público, sin login. Cada
 * envío corre el flow con {{trigger.fields.<campo>}}. No muestra nada del
 * flow ni del workspace, solo el formulario.
 */
export default async function FlowFormPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  if (!/^fh_[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const form = await publicForm(token);
  if (!form) notFound();
  const t = await getTranslations({ locale, namespace: 'flow' });
  return (
    <main className="fa">
      <div className="fa-card">
        <h1 className="fa-title">{form.title || t('formPage.title')}</h1>
        {form.description && <p className="fa-message">{form.description}</p>}
        {form.open ? (
          <HostedForm token={token} fields={form.fields} submitLabel={form.submitLabel} successMessage={form.successMessage} />
        ) : (
          <p className="fa-state-title" role="status">
            {t('formPage.closed')}
          </p>
        )}
      </div>
    </main>
  );
}
