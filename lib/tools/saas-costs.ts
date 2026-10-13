import { INCUMBENTS, PRODUCT_NAMES } from '@/components/site/catalog';

/**
 * Calculadora de costo SaaS: herramientas que suele pagar un equipo, a precio
 * de lista (se muestra como "precio de lista, verificalo con el proveedor").
 * Las de la suite salen de INCUMBENTS (mismos números que las páginas de
 * producto); el resto se suma acá.
 */

export interface SaasTool {
  id: string;
  vendor: string;
  /** USD por mes (por usuario si perUser). */
  monthly: number;
  perUser: boolean;
  /** App de zerosoft que lo reemplaza. */
  replacedBy: string;
}

const FROM_CATALOG: SaasTool[] = (Object.keys(INCUMBENTS) as Array<keyof typeof INCUMBENTS>).map((k) => ({
  id: INCUMBENTS[k].rival.toLowerCase(),
  vendor: INCUMBENTS[k].rival,
  monthly: INCUMBENTS[k].monthly,
  perUser: INCUMBENTS[k].perUser,
  replacedBy: PRODUCT_NAMES[k],
}));

/** Precios de lista de entrada (USD, facturación anual) a octubre de 2026. */
const EXTRA: SaasTool[] = [
  { id: 'zapier', vendor: 'Zapier', monthly: 19.99, perUser: false, replacedBy: 'Flow' },
  { id: 'miro', vendor: 'Miro', monthly: 8, perUser: true, replacedBy: 'Board' },
  { id: 'evernote', vendor: 'Evernote', monthly: 14.99, perUser: true, replacedBy: 'Notes' },
];

const ORDER = ['hubspot', 'intercom', 'calendly', 'notion', 'linear', 'bitly', 'zapier', 'miro', 'evernote'];

export const SAAS_TOOLS: readonly SaasTool[] = [...FROM_CATALOG, ...EXTRA].sort(
  (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
);

export function yearlyCost(tool: SaasTool, seats: number): number {
  const s = Math.max(0, Math.floor(Number.isFinite(seats) ? seats : 0));
  return Math.round(tool.monthly * 12 * (tool.perUser ? s : s > 0 ? 1 : 0) * 100) / 100;
}

export interface SaasSelection {
  id: string;
  seats: number;
}

export function totalYearly(selection: SaasSelection[]): number {
  const total = selection.reduce((sum, sel) => {
    const tool = SAAS_TOOLS.find((t) => t.id === sel.id);
    return tool ? sum + yearlyCost(tool, sel.seats) : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}
