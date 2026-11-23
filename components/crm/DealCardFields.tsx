'use client';

import { useTranslations } from 'next-intl';
import { formatCustomFieldValue } from '@/lib/crm-custom-fields';
import type { CrmCustomFieldType } from '@/lib/schema/types';
import { cardLabelKey, customLayoutName } from '@/lib/crm-layouts-shared';
import PrivateRecord from './PrivateRecord';

/** Lo que una tarjeta de deal necesita para mostrar sus propiedades. */
export interface CardDeal {
  amount: number;
  currency: string;
  company_name?: string | null;
  contact_name?: string | null;
  company_private?: boolean;
  contact_private?: boolean;
  close_date: string | null;
  owner_id: string | null;
  /** Workspace: sin propietario, es el dueño del workspace (como en la ficha). */
  user_id?: string;
  priority: string;
  deal_type?: string | null;
  source?: string;
  next_step?: string | null;
  created_at?: string;
  last_activity_at?: string | null;
  custom?: string;
}

/** Definición de una propiedad personalizada que la persona ve. */
export interface CardCustomDef {
  name: string;
  label: string;
  type: string;
  options?: string | null;
}

interface DealCardFieldsProps {
  deal: CardDeal;
  /** Propiedades configuradas (lib/crm-layouts-shared.ts), ya sin las ocultas para quien mira. */
  keys: readonly string[];
  customDefs: readonly CardCustomDef[];
  owners: ReadonlyMap<string, string>;
  locale: string;
  /** Lo que va al pie después de la fecha y la prioridad (score, deal estancado). */
  footExtra?: React.ReactNode;
}

function parseCustom(json: string | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Iniciales para el avatar del propietario. */
export function ownerInitials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

function money(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Día del calendario (sin hora): no se corre por zona horaria. */
function day(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  } catch {
    return value;
  }
}

/** Fecha y hora guardada en UTC ("YYYY-MM-DD HH:MM:SS"): se muestra en la zona de quien mira. */
function instant(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
}

/**
 * Propiedades de una tarjeta de deal según "Editar tarjetas": el monto y la
 * empresa o el contacto arriba, el resto como pares nombre/valor, y la fecha
 * de cierre, la prioridad y el propietario al pie. Una propiedad vacía no
 * ocupa lugar. La usan el board y la vista previa de Ajustes.
 */
export default function DealCardFields({ deal, keys, customDefs, owners, locale, footExtra }: DealCardFieldsProps) {
  const t = useTranslations('crm');
  const custom = parseCustom(deal.custom);
  const defs = new Map(customDefs.map((d) => [d.name, d]));
  const top: React.ReactNode[] = [];
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const label = (k: string) => (t.has(cardLabelKey(k)) ? t(cardLabelKey(k)) : k);

  for (const k of keys) {
    const name = customLayoutName(k);
    if (name) {
      const def = defs.get(name);
      if (!def) continue;
      const value = formatCustomFieldValue({ type: def.type as CrmCustomFieldType, options: def.options ?? '' }, custom[name], {
        locale,
        yes: t('common.yes'),
        no: t('common.no'),
        users: owners,
      });
      if (value) rows.push({ key: k, label: def.label, value });
      continue;
    }
    switch (k) {
      case 'amount':
        top.push(
          <span key={k} className="kb-card-amount num">
            {money(deal.amount, deal.currency, locale)}
          </span>,
        );
        break;
      case 'company':
      case 'contact': {
        // Sin "Contacto" aparte, "Empresa" cae en el contacto si el deal no tiene empresa (como antes).
        const fallback = k === 'company' && !keys.includes('contact') && !deal.company_name && !deal.company_private;
        const isCompany = k === 'company' && !fallback;
        const nameText = isCompany ? deal.company_name : deal.contact_name;
        const hidden = isCompany ? deal.company_private : deal.contact_private;
        if (nameText) {
          top.push(
            <span key={k} className="kb-card-meta" data-card-prop={k}>
              {nameText}
            </span>,
          );
        } else if (hidden) {
          top.push(
            <span key={k} className="kb-card-meta" data-card-prop={k}>
              <PrivateRecord label={t('common.privateRecord')} />
            </span>,
          );
        }
        break;
      }
      case 'dealType':
        if (deal.deal_type) rows.push({ key: k, label: label(k), value: t.has(`enums.dealType.${deal.deal_type}`) ? t(`enums.dealType.${deal.deal_type}`) : deal.deal_type });
        break;
      case 'source':
        if (deal.source) rows.push({ key: k, label: label(k), value: t.has(`enums.source.${deal.source}`) ? t(`enums.source.${deal.source}`) : deal.source });
        break;
      case 'nextStep':
        if (deal.next_step) rows.push({ key: k, label: label(k), value: deal.next_step });
        break;
      case 'createdAt':
        if (deal.created_at) rows.push({ key: k, label: label(k), value: instant(deal.created_at, locale) });
        break;
      case 'lastActivity':
        if (deal.last_activity_at) rows.push({ key: k, label: label(k), value: instant(deal.last_activity_at, locale) });
        break;
      default:
        break;
    }
  }

  const showClose = keys.includes('closeDate') && !!deal.close_date;
  // Solo la alta: media y baja en cada tarjeta serían ruido (como HubSpot, que destaca la alta).
  const showPriority = keys.includes('priority') && deal.priority === 'high';
  const ownerId = deal.owner_id ?? deal.user_id ?? null;
  const ownerName = keys.includes('ownerId') && ownerId ? owners.get(ownerId) : undefined;

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
      <div className="kb-card-foot">
        {showClose && (
          <span className="kb-card-date" title={t('deals.table.closeDate')} data-card-prop="closeDate">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="1" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            {day(deal.close_date, locale)}
          </span>
        )}
        {showPriority && (
          <span className={`kb-card-prio kb-card-prio-${deal.priority}`} title={t('deals.form.priority')} data-card-prop="priority">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
            {t.has(`enums.priority.${deal.priority}`) ? t(`enums.priority.${deal.priority}`) : deal.priority}
          </span>
        )}
        {footExtra}
        {ownerName && (
          <span
            className="kb-card-owner"
            title={t('deals.cardOwner', { name: ownerName })}
            role="img"
            aria-label={t('deals.cardOwner', { name: ownerName })}
            data-testid="kb-card-owner"
          >
            {ownerInitials(ownerName)}
          </span>
        )}
      </div>
    </>
  );
}
