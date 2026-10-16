import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listForms } from '@/lib/crm-forms';
import { formatDate } from '@/lib/utils';
import FormQuickCreate from '@/components/crm/FormQuickCreate';
import CopyButton from '@/components/link/CopyButton';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { FORM_TONE, badgeClass } from '@/lib/crm-ui-tones';

export const dynamic = 'force-dynamic';

/** Formularios de captura de leads: página propia (/f/<key>) o embebidos en un sitio. */
export default async function FormsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const forms = await listForms(user.id);
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');

  return (
    <div className="app-page ui-page">
      <PageHeader title={t('forms.title')} description={t('forms.subtitle')} actions={forms.length > 0 ? <FormQuickCreate /> : undefined} />

      {forms.length === 0 ? (
        <EmptyState
          title={t('forms.emptyTitle')}
          body={t('forms.emptySub')}
          action={<FormQuickCreate variant="empty" label={t('forms.emptyCta')} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="table forms-table crm-stack">
            <caption className="sr-only">{t('forms.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('forms.table.name')}</th>
                <th scope="col">{t('forms.table.status')}</th>
                <th scope="col" className="num">
                  {t('forms.table.submissions')}
                </th>
                <th scope="col">{t('forms.table.last')}</th>
                <th scope="col">{t('forms.table.link')}</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => {
                const url = `${base}/${locale}/f/${f.slug ?? f.token}`;
                return (
                  <tr key={f.id}>
                    <td className="crm-stack-main">
                      <Link href={`/app/crm/forms/${f.id}`} className="cell-link">
                        {f.name}
                      </Link>
                    </td>
                    <td className="crm-stack-state">
                      <span className={badgeClass(FORM_TONE, f.status)}>{t(`forms.status.${f.status}`)}</span>
                    </td>
                    <td className="num" data-label={t('forms.table.submissions')}>
                      <Link href={`/app/crm/forms/${f.id}?tab=submissions`}>{f.submission_count}</Link>
                    </td>
                    {f.last_submission_at ? (
                      <td className="data" data-label={t('forms.table.last')}>
                        {formatDate(f.last_submission_at, locale)}
                      </td>
                    ) : (
                      <td className="forms-never" data-label={t('forms.table.last')}>
                        {t('forms.never')}
                      </td>
                    )}
                    <td className="forms-link-cell" data-label={t('forms.table.link')}>
                      <a href={url} target="_blank" rel="noreferrer" className="data forms-url">
                        /f/{f.slug ?? f.token}
                      </a>
                      <CopyButton text={url} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
