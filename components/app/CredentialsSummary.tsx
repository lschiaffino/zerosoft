import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { CredentialDto } from '@/lib/flow-credentials';
import DataTable from '@/components/ui/DataTable';
import FormSection from '@/components/ui/FormSection';

/**
 * Credenciales del workspace (Flow y Robots) vistas desde Ajustes. Son las
 * mismas filas de /app/flow/credentials; se crean y editan allá, que es donde
 * está el formulario por tipo. Server component.
 */
export default async function CredentialsSummary({
  credentials,
  canEdit,
  locale,
}: {
  credentials: CredentialDto[];
  canEdit: boolean;
  locale: string;
}) {
  const t = await getTranslations({ locale, namespace: 'settings.credentials' });
  const tf = await getTranslations({ locale, namespace: 'flow.credentials' });
  const format = await getFormatter({ locale });
  const now = new Date();
  const typeLabel = (type: string) => (tf.has(`types.${type}`) ? tf(`types.${type}`) : type);

  return (
    <FormSection
      id="credentials"
      title={t('title')}
      description={t('desc')}
      footer={
        <>
          <p className="ui-section-note">{t('note')}</p>
          {credentials.length > 0 && (
            <Link href="/app/flow/credentials" className="btn btn-secondary btn-sm">
              {t('manage')}
            </Link>
          )}
        </>
      }
    >
      <DataTable
        caption={t('title')}
        rows={credentials}
        rowKey={(c) => c.id}
        compact
        empty={
          <p className="st-empty-line">
            {t('emptyLine')}
            {canEdit && (
              <>
                {' '}
                <Link href="/app/flow/credentials" className="st-inline-link">
                  {t('createInFlow')}
                </Link>
              </>
            )}
          </p>
        }
        columns={[
          { key: 'name', header: t('colName'), cell: (c) => c.name, data: true },
          { key: 'type', header: t('colType'), cell: (c) => typeLabel(c.type) },
          {
            key: 'updated',
            header: t('colUpdated'),
            cell: (c) => <span className="st-muted">{format.relativeTime(new Date(c.updatedAt), now)}</span>,
          },
        ]}
      />
    </FormSection>
  );
}
