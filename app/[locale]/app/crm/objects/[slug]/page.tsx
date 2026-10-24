import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { getObjectBySlug, listRecords, objectEntity } from '@/lib/crm-objects';
import { parseCustom, parseFilterRules } from '@/lib/crm';
import { fieldAccessFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import { fieldOptions } from '@/lib/crm-custom-fields';
import { ownerOptions } from '@/lib/crm-owners';
import { formatDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import CrmPager from '@/components/crm/CrmPager';
import FilterBuilder, { type FilterBuilderField } from '@/components/crm/FilterBuilder';
import ListToolbar from '@/components/crm/ListToolbar';
import ObjectRecordCreate from '@/components/crm/ObjectRecordCreate';
import CustomFieldsPanel from '@/components/crm/CustomFieldsPanel';
import DangerDelete from '@/components/crm/DangerDelete';
import { ObjectDefinitionForm, ObjectImport } from '@/components/crm/ObjectSettings';
import { customBuilderFields, customCells, customFilterTypes } from '@/components/crm/customFieldViews';
import { listCustomFields } from '@/lib/crm';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const SORTS = ['newest', 'oldest', 'name', 'name_desc'] as const;
type Sort = (typeof SORTS)[number];
/** Columnas de propiedades que se muestran en la tabla (el resto, en la ficha). */
const MAX_COLUMNS = 4;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Lista de registros de un objeto propio: búsqueda, owner, orden, filtro
 * avanzado por propiedades y paginación. Con ?settings=1 (admins) muestra la
 * definición del objeto, sus propiedades, el import CSV y el borrado.
 */
export default async function ObjectRecordsPage(props: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const object = await getObjectBySlug(user.id, slug);
  if (!object) notFound();
  const admin = isWorkspaceAdmin(user);
  const entity = objectEntity(object.id);
  const primaryLabel = object.primary_label || t('objects.defaultPrimary');
  const base = `/app/crm/objects/${object.slug}`;

  const q = one(sp.q) ?? '';
  const owner = one(sp.owner) ?? '';
  const sortParam = one(sp.sort) ?? 'newest';
  const sort: Sort = (SORTS as readonly string[]).includes(sortParam) ? (sortParam as Sort) : 'newest';
  const page = Number(one(sp.page) ?? '1') || 1;
  const rawFilters = one(sp.filters) ?? '';
  const settingsOpen = admin && one(sp.settings) === '1';

  const [access, owners, scope] = await Promise.all([
    fieldAccessFor(sessionFieldViewer(user), entity),
    ownerOptions(user),
    sessionScope(user),
  ]);
  const defs = access.visible;
  const customTypes = customFilterTypes(defs);
  const rules = parseFilterRules(rawFilters).filter((r) => !r.f.startsWith('custom:') || r.f.slice(7) in customTypes);
  const { rows, total } = await listRecords(user.id, object.id, {
    q: q || undefined,
    owner: owner || undefined,
    filters: rules,
    customTypes,
    ownerScope: scope,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const query: Record<string, string> = Object.fromEntries(
    Object.entries({ q, owner, sort: sort === 'newest' ? '' : sort, filters: rawFilters }).filter(([, v]) => v),
  );
  const hasFilters = !!(q || owner || rules.length);

  const cellCtx = { locale, yes: t('common.yes'), no: t('common.no'), users: new Map(owners.map((o) => [o.value, o.label])) };
  const columns = defs.slice(0, MAX_COLUMNS);
  const builderFields: FilterBuilderField[] = [
    { key: 'name', label: primaryLabel, type: 'text' },
    { key: 'owner', label: t('objects.owner'), type: 'select', options: owners },
    { key: 'created', label: t('objects.created'), type: 'date' },
    ...customBuilderFields(defs, { yes: t('common.yes'), no: t('common.no') }, owners),
  ];
  const createFields = defs
    .filter((d) => d.access === 'edit')
    .map((d) => ({
      name: d.name,
      label: d.label,
      type: d.type,
      options: fieldOptions(d),
      ...(d.type === 'user' ? { choices: owners } : {}),
    }));

  const createButton = (variant: 'primary' | 'empty') => (
    <ObjectRecordCreate
      objectId={object.id}
      singular={object.singular}
      primaryLabel={primaryLabel}
      owners={owners}
      defaultOwner={realUserId(user)}
      fields={createFields}
      variant={variant}
    />
  );

  let settings: React.ReactNode = null;
  if (settingsOpen) {
    const allFields = await listCustomFields(user.id, entity);
    settings = (
      <div role="region" className="obj-settings" aria-label={t('objects.settingsTitle', { plural: object.plural })} data-testid="object-settings">
        <FormSection title={t('objects.settingsTitle', { plural: object.plural })} description={object.description || undefined}>
          <ObjectDefinitionForm
            object={{
              id: object.id,
              singular: object.singular,
              plural: object.plural,
              primaryLabel: object.primary_label,
              description: object.description,
            }}
          />
        </FormSection>
        <FormSection title={t('objects.propertiesTitle')} description={t('objects.propertiesDesc', { singular: object.singular })}>
          <CustomFieldsPanel initialFields={allFields} entities={[{ value: entity, label: object.plural }]} />
        </FormSection>
        <FormSection title={t('objects.import.title')}>
          <ObjectImport
            objectId={object.id}
            primaryLabel={primaryLabel}
            properties={allFields.map((f) => ({ name: f.name, label: f.label }))}
          />
        </FormSection>
        <FormSection title={t('objects.deleteTitle')}>
          <DangerDelete
            bare
            endpoint={`/api/crm/objects/${object.id}`}
            confirmToken={object.plural}
            redirectTo="/app/crm/objects"
            title={t('objects.deleteTitle')}
            desc={t('objects.deleteDesc')}
            buttonLabel={t('objects.deleteButton')}
            confirmLabel={t('record.confirmType', { token: object.plural })}
            errorLabel={t('errors.generic')}
          />
        </FormSection>
      </div>
    );
  }

  return (
    <div className="app-page ui-page crm-objects-page">
      <PageHeader
        back={{ href: '/app/crm/objects', label: t('objects.back') }}
        title={object.plural}
        description={object.description || undefined}
        actions={
          <>
            {admin && (
              <Link
                href={settingsOpen ? base : `${base}?settings=1`}
                className="btn btn-secondary btn-sm"
                aria-expanded={settingsOpen}
              >
                {t('objects.settings')}
              </Link>
            )}
            {createButton('primary')}
          </>
        }
      />

      {settings}

      <ListToolbar
        searchLabel={t('objects.search', { plural: object.plural })}
        q={q}
        query={query}
        selects={[
          {
            param: 'owner',
            label: t('objects.owner'),
            value: owner,
            options: [{ value: '', label: t('objects.allOwners') }, ...owners],
          },
          {
            param: 'sort',
            label: t('common.sortBy'),
            value: sort === 'newest' ? '' : sort,
            options: [
              { value: '', label: t('objects.sortNewest') },
              { value: 'oldest', label: t('objects.sortOldest') },
              { value: 'name', label: t('objects.sortName') },
              { value: 'name_desc', label: t('objects.sortNameDesc') },
            ],
          },
        ]}
      />
      <FilterBuilder fields={builderFields} initial={rules} baseQuery={query} />

      {rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title={t('objects.noMatchTitle')}
            body={t('objects.noMatchBody')}
            action={{ label: t('objects.clearFilters'), href: base }}
          />
        ) : (
          <EmptyState
            title={t('objects.emptyRecordsTitle', { plural: object.plural })}
            body={t('objects.emptyRecordsBody')}
            action={createButton('empty')}
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="table crm-table" data-testid="object-records">
              <caption className="sr-only">{object.plural}</caption>
              <thead>
                <tr>
                  <th scope="col">{primaryLabel}</th>
                  {columns.map((c) => (
                    <th key={c.id} scope="col" className={`hide-sm${c.type === 'number' || c.type === 'currency' ? ' num' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="hide-sm">
                    {t('objects.owner')}
                  </th>
                  <th scope="col" className="num cell-date">
                    {t('objects.created')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cells = customCells(columns, parseCustom(r.custom), cellCtx);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`${base}/${r.id}`} className="cell-name">
                          {r.name}
                        </Link>
                      </td>
                      {columns.map((c) => {
                        const cell = cells[`custom:${c.name}`];
                        return (
                          <td key={c.id} className={`muted hide-sm${c.type === 'number' || c.type === 'currency' ? ' num' : ''}`}>
                            {cell ? (
                              cell.href ? (
                                <a href={cell.href} target="_blank" rel="noreferrer">
                                  {cell.text}
                                </a>
                              ) : (
                                cell.text
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                      <td className="muted hide-sm">{cellCtx.users.get(r.owner_id ?? user.id) ?? r.owner_name ?? '—'}</td>
                      <td className="num muted cell-date">{formatDate(r.created_at, locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <CrmPager pathname={base} query={query} page={Math.min(page, pages)} pages={pages} total={total} locale={locale} />
        </>
      )}
    </div>
  );
}
