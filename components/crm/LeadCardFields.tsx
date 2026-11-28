'use client';

import { useTranslations } from 'next-intl';
import { formatCustomFieldValue } from '@/lib/crm-custom-fields';
import type { CrmCustomFieldType } from '@/lib/schema/types';
import { cardLabelKey, customLayoutName } from '@/lib/crm-layouts-shared';
import { ownerInitials, type CardCustomDef } from './DealCardFields';

/** Lo que una tarjeta de lead necesita para mostrar sus propiedades. */
export interface CardLead {
  /** Nombre del contacto ('' si es el mismo que el del lead o no tiene); "Registro privado" ya resuelto. */
  contact: string;
  company: string;
  /** Nombre del propietario (sin propietario, el dueño del workspace). */
  owner: string;
  source?: string;
  created_at?: string;
  last_activity_at?: string | null;
  custom?: string;
}

function parseCustom(json: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Fecha y hora guardada en UTC: se muestra en la zona de quien mira. */
function instant(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
}

/**
 * Propiedades de una tarjeta del board de leads según "Tarjetas del board":
 * contacto y empresa arriba, el resto como pares nombre/valor y el
 * propietario al pie (con lo que agregue el board, como "Mover a"). Una
 * propiedad vacía no ocupa lugar. La usan el board y la muestra de Ajustes.
 */
export default function LeadCardFields({
  lead,
  keys,
  customDefs,
  locale,
  footExtra,
  users,
}: {
  lead: CardLead;
  keys: readonly string[];
  customDefs: readonly CardCustomDef[];
  locale: string;
  footExtra?: React.ReactNode;
  /** Personas (para las propiedades personalizadas de tipo persona). */
  users?: ReadonlyMap<string, string>;
}) {
  const t = useTranslations('crm');
  const custom = parseCustom(lead.custom);
  const defs = new Map(customDefs.map((d) => [d.name, d]));
  const top: React.ReactNode[] = [];
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const label = (k: string) => (t.has(cardLabelKey(k, 'leads')) ? t(cardLabelKey(k, 'leads')) : k);

  for (const k of keys) {
    const name = customLayoutName(k);
    if (name) {
      const def = defs.get(name);
      if (!def) continue;
      const value = formatCustomFieldValue({ type: def.type as CrmCustomFieldType, options: def.options ?? '' }, custom[name], {
        locale,
        yes: t('common.yes'),
        no: t('common.no'),
        users,
      });
      if (value) rows.push({ key: k, label: def.label, value });
      continue;
    }
    switch (k) {
      case 'contact':
      case 'company': {
        const text = k === 'contact' ? lead.contact : lead.company;
        if (text) {
          top.push(
            <span key={k} className="kb-card-meta" data-card-prop={k}>
              {text}
            </span>,
          );
        }
        break;
      }
      case 'source':
        if (lead.source) rows.push({ key: k, label: label(k), value: t.has(`enums.source.${lead.source}`) ? t(`enums.source.${lead.source}`) : lead.source });
        break;
      case 'createdAt':
        if (lead.created_at) rows.push({ key: k, label: label(k), value: instant(lead.created_at, locale) });
        break;
      case 'lastActivity':
        if (lead.last_activity_at) rows.push({ key: k, label: label(k), value: instant(lead.last_activity_at, locale) });
        break;
      default:
        break;
    }
  }

  const showOwner = keys.includes('ownerId') && !!lead.owner;

  return (
    <>
      {top}
      {rows.length > 0 && (
        <dl className="kb-card-props">
          {rows.map((r) => (
            <div key={r.key} className="kb-card-prop" data-card-prop={r.key}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(showOwner || footExtra) && (
        <span className="kb-card-foot">
          {footExtra}
          {showOwner && (
            <span
              className="kb-card-owner"
              title={t('deals.cardOwner', { name: lead.owner })}
              role="img"
              aria-label={t('deals.cardOwner', { name: lead.owner })}
              data-testid="kb-card-owner"
            >
              {ownerInitials(lead.owner)}
            </span>
          )}
        </span>
      )}
    </>
  );
}
