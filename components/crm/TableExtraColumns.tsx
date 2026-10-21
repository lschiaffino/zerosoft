'use client';

import { useTranslations } from 'next-intl';
import SortTh from './SortTh';
import InlineEditCell from './InlineEditCell';
import { customSortValue } from '@/lib/crm-list-sort';
import type { CustomColumn } from './customFieldViews';

/**
 * Columnas compartidas por las tablas de contactos, empresas y deals: owner
 * (ordenable y editable inline) y los custom fields (headers ordenables).
 */

interface Option {
  value: string;
  label: string;
}

export function OwnerHeader({ sort }: { sort: string }) {
  const t = useTranslations('crm');
  return (
    <th>
      <SortTh label={t('filters.field.owner')} asc="owner" desc="owner_desc" current={sort} />
    </th>
  );
}

export function OwnerCell({
  endpoint,
  ownerId,
  owners,
}: {
  endpoint: string;
  ownerId: string | null | undefined;
  owners: Option[];
}) {
  const label = ownerId ? owners.find((o) => o.value === ownerId)?.label ?? '' : '';
  return (
    <td className="cell-sub">
      <InlineEditCell
        endpoint={endpoint}
        field="ownerId"
        value={ownerId ?? ''}
        displayValue={label || '—'}
        type="select"
        options={owners}
        nullOption
        className="muted"
      />
    </td>
  );
}

/** `custom:<name>` → nombre del campo para el orden `cf:<name>`. */
function fieldName(col: CustomColumn): string {
  return col.id.startsWith('custom:') ? col.id.slice(7) : col.id;
}

export function CustomColumnHeader({ col, sort }: { col: CustomColumn; sort: string }) {
  const name = fieldName(col);
  return (
    <th className={col.numeric ? 'num' : undefined}>
      <SortTh label={col.label} asc={customSortValue(name)} desc={customSortValue(name, true)} current={sort} />
    </th>
  );
}
