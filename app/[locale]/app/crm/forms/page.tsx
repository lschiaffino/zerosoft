import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listForms } from '@/lib/crm-forms';
import { formatDate } from '@/lib/utils';
import FormQuickCreate from '@/components/crm/FormQuickCreate';
import CopyButton from '@/components/link/CopyButton';

export const dynamic = 'force-dynamic';

/** Formularios de captura de leads: página propia (/f/<key>) o embebidos en un sitio. */
export default async function FormsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const forms = await listForms(user.id);
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('forms.title')}</h1>
          <p className="muted app-sub">{t('forms.subtitle')}</p>
        </div>
        <FormQuickCreate />
      </div>

      {forms.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('forms.emptyTitle')}</h2>
          <p className="muted">{t('forms.emptySub')}</p>
          <FormQuickCreate variant="empty" label={t('forms.emptyCta')} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table forms-table">
            <thead>
              <tr>
                <th>{t('forms.table.name')}</th>
                <th>{t('forms.table.status')}</th>
                <th className="num">{t('forms.table.submissions')}</th>
                <th>{t('forms.table.last')}</th>
                <th>{t('forms.table.link')}</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => {
                const url = `${base}/${locale}/f/${f.slug ?? f.token}`;
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/app/crm/forms/${f.id}`} className="row-link">
                        {f.name}
                      </Link>
                    </td>
                    <td>
                      <span className={`forms-status forms-status-${f.status}`}>{t(`forms.status.${f.status}`)}</span>
                    </td>
                    <td className="num mono">
                      <Link href={`/app/crm/forms/${f.id}?tab=submissions`}>{f.submission_count}</Link>
                    </td>
                    <td className="mono muted">{f.last_submission_at ? formatDate(f.last_submission_at, locale) : '—'}</td>
                    <td className="forms-link-cell">
                      <a href={url} target="_blank" rel="noreferrer" className="mono muted forms-url">
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
