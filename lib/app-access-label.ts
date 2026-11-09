/**
 * Cómo nombrar las apps a las que entra una persona (invitación, email,
 * pendientes): con pocas, la lista ("CRM y Docs"); con la mayoría, lo que
 * falta ("todas las apps menos Track"), así no se leen 23 nombres.
 */
import { APP_SWITCHER_ORDER, PRODUCT_CONFIG, isAlwaysOnApp, isProductKey } from './products';

export type AppsDescription = { kind: 'all' } | { kind: 'list'; names: string[] } | { kind: 'except'; names: string[] };

export function describeApps(apps: readonly string[] | '*'): AppsDescription {
  if (apps === '*') return { kind: 'all' };
  // Las apps personales (Inbox) no son del workspace: no se cuentan.
  const granted = [...new Set(apps.filter((k) => isProductKey(k) && !isAlwaysOnApp(k)))];
  const all = (APP_SWITCHER_ORDER as readonly string[]).filter((k) => !isAlwaysOnApp(k));
  const missing = all.filter((k) => !granted.includes(k as (typeof granted)[number]));
  const name = (k: string) => (isProductKey(k) ? PRODUCT_CONFIG[k].name : k);
  if (missing.length === 0) return { kind: 'all' };
  if (granted.length > all.length / 2) return { kind: 'except', names: missing.map(name) };
  return { kind: 'list', names: granted.map(name) };
}

/** "CRM, Docs y Track" en el idioma de la persona. */
export function joinNames(names: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}
