import type { CrmCustomFieldRow } from '@/lib/schema/types';
import { fieldOptions, filterTypeFor } from '@/lib/crm-custom-fields';
import { DEAL_TYPES } from '@/lib/crm-constants';
import { OWNER_ME, OWNER_UNASSIGNED, type FilterFieldShape, type FilterFieldType } from '@/lib/crm-filter-model';

/**
 * Propiedades que ofrece el panel de filtros avanzados de cada listado
 * (contactos, empresas, deals). Las claves son las de los mapas de lib/crm.ts
 * (CRM_FILTER_FIELDS); las propias van como `custom:<name>`. Puro: lo arman
 * las páginas server y viaja al panel como props.
 */

export interface AdvFilterOption {
  value: string;
  label: string;
}

export interface AdvFilterField {
  key: string;
  label: string;
  type: FilterFieldType;
  /** Título del grupo bajo el que aparece en el buscador de propiedades. */
  group: string;
  options?: AdvFilterOption[];
  /** Operadores, si no son todos los de su tipo. */
  ops?: string[];
}

type T = (key: string) => string;

interface Common {
  t: T;
  owners: AdvFilterOption[];
  tags: AdvFilterOption[];
  customDefs: CrmCustomFieldRow[];
}

/** Owner con "Yo" y "Sin asignar" primero. */
function ownerOptions(t: T, owners: AdvFilterOption[]): AdvFilterOption[] {
  return [
    { value: OWNER_ME, label: t('filters.me') },
    { value: OWNER_UNASSIGNED, label: t('filters.unassigned') },
    ...owners,
  ];
}

function activityFields(t: T): AdvFilterField[] {
  const group = t('filters.groupActivity');
  return [
    { key: 'lastActivity', label: t('activityDates.lastActivity'), type: 'date', group },
    { key: 'lastContacted', label: t('activityDates.lastContacted'), type: 'date', group },
    { key: 'nextActivity', label: t('activityDates.nextActivity'), type: 'date', group },
  ];
}

function tagField(t: T, tags: AdvFilterOption[], group: string): AdvFilterField[] {
  return tags.length ? [{ key: 'tag', label: t('filters.field.tag'), type: 'select', group, options: tags }] : [];
}

/** Las propiedades propias del objeto (`custom:<name>`), con el tipo con que el server las compara. */
export function customFilterFields(defs: CrmCustomFieldRow[], owners: AdvFilterOption[], group: string): AdvFilterField[] {
  return defs.map((cf): AdvFilterField => {
    const key = `custom:${cf.name}`;
    const type = filterTypeFor(cf.type);
    if (cf.type === 'user') return { key, label: cf.label, type, group, options: owners };
    if (type === 'select' || type === 'multiselect') {
      return { key, label: cf.label, type, group, options: fieldOptions(cf).map((o) => ({ value: o, label: o })) };
    }
    return { key, label: cf.label, type, group };
  });
}

export function contactFilterFields(
  opts: Common & {
    companies: AdvFilterOption[];
    lifecycles: AdvFilterOption[];
    leadStatuses: AdvFilterOption[];
    sources: AdvFilterOption[];
    /** Scores por puntos (`score` el principal, `score:<id>` los demás) y por tramo (`scoreTier:<id>`). */
    scores: Array<{ key: string; label: string; tiers?: AdvFilterOption[] }>;
    staticLists?: AdvFilterOption[];
  },
): AdvFilterField[] {
  const { t } = opts;
  const group = t('filters.groupContact');
  const activity = t('filters.groupActivity');
  return [
    { key: 'name', label: t('filters.field.name'), type: 'text', group },
    { key: 'firstName', label: t('contacts.form.firstName'), type: 'text', group },
    { key: 'lastName', label: t('contacts.form.lastName'), type: 'text', group },
    { key: 'email', label: t('filters.field.email'), type: 'text', group },
    { key: 'phone', label: t('contacts.form.phone'), type: 'text', group },
    { key: 'jobTitle', label: t('contacts.form.jobTitle'), type: 'text', group },
    { key: 'company', label: t('filters.field.company'), type: 'select', group, options: opts.companies },
    { key: 'companyName', label: t('filters.field.companyName'), type: 'text', group },
    { key: 'lifecycle', label: t('filters.field.lifecycle'), type: 'select', group, options: opts.lifecycles },
    { key: 'leadStatus', label: t('filters.field.leadStatus'), type: 'select', group, options: opts.leadStatuses },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', group, options: ownerOptions(t, opts.owners) },
    { key: 'source', label: t('filters.field.source'), type: 'select', group, options: opts.sources },
    { key: 'website', label: t('contacts.form.website'), type: 'text', group },
    { key: 'city', label: t('contacts.form.city'), type: 'text', group },
    { key: 'country', label: t('contacts.form.country'), type: 'text', group },
    ...opts.scores.map(
      (s): AdvFilterField =>
        s.tiers ? { key: s.key, label: s.label, type: 'select', group, options: s.tiers, ops: ['is', 'isnot'] } : { key: s.key, label: s.label, type: 'number', group, ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] },
    ),
    ...tagField(t, opts.tags, group),
    { key: 'created', label: t('filters.field.created'), type: 'date', group },
    { key: 'updated', label: t('filters.field.updated'), type: 'date', group },
    ...customFilterFields(opts.customDefs, opts.owners, t('filters.groupCustom')),
    ...activityFields(t),
    { key: 'daysSinceContacted', label: t('listFilters.fields.daysSinceContacted'), type: 'number', group: activity },
    { key: 'daysSinceActivity', label: t('listFilters.fields.daysSinceActivity'), type: 'number', group: activity },
    { key: 'hasOpenDeal', label: t('listFilters.fields.hasOpenDeal'), type: 'boolean', group: activity, ops: ['true', 'false'] },
    { key: 'dealCount', label: t('listFilters.fields.dealCount'), type: 'number', group: activity },
    { key: 'emailsOpened', label: t('listFilters.fields.emailsOpened'), type: 'number', group: activity },
    { key: 'emailsReplied', label: t('listFilters.fields.emailsReplied'), type: 'number', group: activity },
    { key: 'formSubmissions', label: t('listFilters.fields.formSubmissions'), type: 'number', group: activity },
    ...(opts.staticLists?.length
      ? [{ key: 'list', label: t('listFilters.fields.list'), type: 'select' as const, group: activity, options: opts.staticLists, ops: ['is', 'isnot'] }]
      : []),
  ];
}

export function companyFilterFields(
  opts: Common & { industries: AdvFilterOption[]; lifecycles: AdvFilterOption[] },
): AdvFilterField[] {
  const { t } = opts;
  const group = t('filters.groupCompany');
  return [
    { key: 'name', label: t('filters.field.name'), type: 'text', group },
    { key: 'domain', label: t('filters.field.domain'), type: 'text', group },
    { key: 'industry', label: t('filters.field.industry'), type: 'select', group, options: opts.industries },
    { key: 'lifecycle', label: t('filters.field.lifecycle'), type: 'select', group, options: opts.lifecycles },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', group, options: ownerOptions(t, opts.owners) },
    { key: 'phone', label: t('companies.form.phone'), type: 'text', group },
    { key: 'website', label: t('companies.form.website'), type: 'text', group },
    { key: 'city', label: t('companies.form.city'), type: 'text', group },
    { key: 'country', label: t('companies.form.country'), type: 'text', group },
    { key: 'employees', label: t('companies.form.employees'), type: 'number', group },
    { key: 'foundedYear', label: t('companiesEnrich.foundedYear'), type: 'number', group },
    { key: 'description', label: t('companiesEnrich.description'), type: 'text', group },
    { key: 'contactCount', label: t('filters.field.contactCount'), type: 'number', group, ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] },
    ...tagField(t, opts.tags, group),
    { key: 'created', label: t('filters.field.created'), type: 'date', group },
    { key: 'updated', label: t('filters.field.updated'), type: 'date', group },
    ...customFilterFields(opts.customDefs, opts.owners, t('filters.groupCustom')),
    ...activityFields(t),
  ];
}

export function dealFilterFields(
  opts: Common & {
    stages: AdvFilterOption[];
    priorities: AdvFilterOption[];
    sources: AdvFilterOption[];
    currencies: AdvFilterOption[];
    forecastCategories: AdvFilterOption[];
    /** Deal type: las opciones del workspace (archivadas incluidas, para filtrar); sin ellas, las de fábrica. */
    dealTypes?: AdvFilterOption[];
  },
): AdvFilterField[] {
  const { t } = opts;
  const group = t('filters.groupDeal');
  return [
    { key: 'name', label: t('filters.field.name'), type: 'text', group },
    { key: 'amount', label: t('filters.field.amount'), type: 'number', group },
    { key: 'stage', label: t('filters.field.stage'), type: 'select', group, options: opts.stages },
    {
      key: 'status',
      label: t('filters.field.dealStatus'),
      type: 'select',
      group,
      options: (['open', 'won', 'lost'] as const).map((v) => ({ value: v, label: t(`filters.dealStatus.${v}`) })),
      ops: ['is', 'isnot'],
    },
    { key: 'owner', label: t('filters.field.owner'), type: 'select', group, options: ownerOptions(t, opts.owners) },
    { key: 'closeDate', label: t('filters.field.closeDate'), type: 'date', group },
    { key: 'priority', label: t('filters.field.priority'), type: 'select', group, options: opts.priorities },
    { key: 'source', label: t('filters.field.source'), type: 'select', group, options: opts.sources },
    { key: 'companyName', label: t('filters.field.companyName'), type: 'text', group },
    { key: 'currency', label: t('deals.form.currency'), type: 'select', group, options: opts.currencies },
    { key: 'forecastCategory', label: t('filters.field.forecastCategory'), type: 'select', group, options: opts.forecastCategories },
    { key: 'description', label: t('deals.form.description'), type: 'text', group },
    { key: 'lostReason', label: t('filters.field.lostReason'), type: 'text', group },
    {
      key: 'dealType',
      label: t('deals.form.dealType'),
      type: 'select',
      group,
      options: opts.dealTypes ?? DEAL_TYPES.map((v) => ({ value: v, label: t(`enums.dealType.${v}`) })),
    },
    { key: 'nextStep', label: t('deals.form.nextStep'), type: 'text', group },
    { key: 'wonReason', label: t('deals.form.wonReason'), type: 'text', group },
    ...tagField(t, opts.tags, group),
    { key: 'created', label: t('filters.field.created'), type: 'date', group },
    { key: 'updated', label: t('filters.field.updated'), type: 'date', group },
    { key: 'closedAt', label: t('filters.field.closedAt'), type: 'date', group },
    ...customFilterFields(opts.customDefs, opts.owners, t('filters.groupCustom')),
    ...activityFields(t),
  ];
}

/** key → tipo y operadores, para validar el filtro de la URL contra lo que el panel ofrece. */
export function filterFieldShapes(fields: AdvFilterField[]): Record<string, FilterFieldShape> {
  const out: Record<string, FilterFieldShape> = {};
  for (const f of fields) out[f.key] = f.ops ? { type: f.type, ops: f.ops } : { type: f.type };
  return out;
}
