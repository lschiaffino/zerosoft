/**
 * Textos de la tienda pública en el idioma de la tienda (no el del
 * visitante): messages/<locale>/shop.json › storefront. Se pasan como objeto
 * a los componentes (la tienda vive fuera de /[locale], sin next-intl).
 */
import en from '@/messages/en/shop.json';
import es from '@/messages/es/shop.json';
import pt from '@/messages/pt/shop.json';

export type StorefrontStrings = (typeof en)['storefront'];

const ALL: Record<string, StorefrontStrings> = { en: en.storefront, es: es.storefront, pt: pt.storefront };

export function storefrontStrings(locale: string): StorefrontStrings {
  return ALL[locale] ?? ALL.en;
}

/** "Hola {name}" + { name } → "Hola Ana". */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
