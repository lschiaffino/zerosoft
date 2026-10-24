import type { CrmCustomFieldRow } from '@/lib/schema/types';
import { LEAD_STATUSES, LIFECYCLE_STAGES, SOURCES } from '@/lib/crm-constants';
import type { FilterBuilderField } from './FilterBuilder';
import { customBuilderFields } from './customFieldViews';

export interface RuleField extends FilterBuilderField {
  group: 'props' | 'custom' | 'activity';
}

interface Option {
  value: string;
  label: string;
}

/**
 * Campos que puede usar el filtro de una lista dinámica: propiedades del
 * contacto, sus campos propios y su actividad (deals abiertos, emails, días
 * desde el último contacto, formularios, listas estáticas). Las claves son las
 * de CONTACT_ADV_FIELDS / CONTACT_ACTIVITY_FIELDS en lib/crm.ts.
 */
export function listRuleFields(opts: {
  t: (key: string) => string;
  owners: Option[];
  tags: Option[];
  staticLists: Option[];
  customDefs: CrmCustomFieldRow[];
}): RuleField[] {
  const { t } = opts;
  const yesNo = [
    { value: '1', label: t('common.yes') },
    { value: '0', label: t('common.no') },
  ];
  const props: RuleField[] = [
    { group: 'props', key: 'name', label: t('filters.field.name'), type: 'text' },
    { group: 'props', key: 'email', label: t('filters.field.email'), type: 'text' },
    {
      group: 'props',
      key: 'lifecycle',
      label: t('filters.field.lifecycle'),
      type: 'select',
      options: LIFECYCLE_STAGES.map((v) => ({ value: v, label: t(`enums.lifecycle.${v}`) })),
    },
    {
      group: 'props',
      key: 'leadStatus',
      label: t('filters.field.leadStatus'),
      type: 'select',
      options: LEAD_STATUSES.map((v) => ({ value: v, label: t(`enums.leadStatus.${v}`) })),
    },
    {
      group: 'props',
      key: 'source',
      label: t('filters.field.source'),
      type: 'select',
      options: SOURCES.map((v) => ({ value: v as string, label: t(`enums.source.${v}`) })),
    },
    { group: 'props', key: 'owner', label: t('filters.field.owner'), type: 'select', options: opts.owners },
    { group: 'props', key: 'score', label: t('scoring.column'), type: 'number' },
    { group: 'props', key: 'created', label: t('listFilters.fields.createdDate'), type: 'date' },
    { group: 'props', key: 'tag', label: t('listFilters.fields.tag'), type: 'select', options: opts.tags },
  ];
  const custom: RuleField[] = customBuilderFields(opts.customDefs, { yes: t('common.yes'), no: t('common.no') }, opts.owners).map(
    (f) => ({ ...f, group: 'custom' as const }),
  );
  const activity: RuleField[] = [
    { group: 'activity', key: 'lastContacted', label: t('activityDates.lastContacted'), type: 'date' },
    { group: 'activity', key: 'lastActivity', label: t('activityDates.lastActivity'), type: 'date' },
    { group: 'activity', key: 'nextActivity', label: t('activityDates.nextActivity'), type: 'date' },
    { group: 'activity', key: 'daysSinceContacted', label: t('listFilters.fields.daysSinceContacted'), type: 'number' },
    { group: 'activity', key: 'daysSinceActivity', label: t('listFilters.fields.daysSinceActivity'), type: 'number' },
    { group: 'activity', key: 'hasOpenDeal', label: t('listFilters.fields.hasOpenDeal'), type: 'select', options: yesNo },
    { group: 'activity', key: 'dealCount', label: t('listFilters.fields.dealCount'), type: 'number' },
    { group: 'activity', key: 'emailsOpened', label: t('listFilters.fields.emailsOpened'), type: 'number' },
    { group: 'activity', key: 'emailsReplied', label: t('listFilters.fields.emailsReplied'), type: 'number' },
    { group: 'activity', key: 'formSubmissions', label: t('listFilters.fields.formSubmissions'), type: 'number' },
    ...(opts.staticLists.length
      ? [{ group: 'activity' as const, key: 'list', label: t('listFilters.fields.list'), type: 'select' as const, options: opts.staticLists }]
      : []),
  ];
  return [...props, ...custom, ...activity];
}
