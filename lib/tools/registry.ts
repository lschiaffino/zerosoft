import type { SiteProductKey } from '../products';

/**
 * Herramientas gratis del sitio (/tools): sin login, la mayoría 100% en el
 * navegador. Cada una tiene su página SEO en /[locale]/tools/<slug> y apunta a
 * la app de zerosoft relacionada ("guardalo en zerosoft").
 *
 * Los textos viven en messages/<locale>/tools.json → items.<slug>.
 */

export type ToolGroup = 'sales' | 'marketing' | 'finance' | 'website';

export const TOOL_GROUPS: readonly ToolGroup[] = ['sales', 'marketing', 'finance', 'website'];

/** Color de la herramienta: clase .card-<accent> de globals.css. */
export type ToolAccent = SiteProductKey;

export interface ToolDef {
  slug: string;
  group: ToolGroup;
  accent: ToolAccent;
  /** Producto relacionado (página /products/<key> y CTA). null = toda la suite. */
  product: SiteProductKey | null;
  /** Usa el modelo (rate limit por IP + fallback sin AI). */
  ai?: boolean;
  /** Corre en el servidor (fetch remoto). */
  server?: boolean;
}

/** Orden = orden en el hub dentro de cada grupo. */
export const TOOLS: readonly ToolDef[] = [
  { slug: 'email-signature-generator', group: 'sales', accent: 'cal', product: 'cal' },
  { slug: 'ai-email-writer', group: 'sales', accent: 'crm', product: 'crm', ai: true },
  { slug: 'buyer-persona-generator', group: 'sales', accent: 'chat', product: 'crm', ai: true },
  { slug: 'qr-code-generator', group: 'marketing', accent: 'link', product: 'link' },
  { slug: 'utm-builder', group: 'marketing', accent: 'link', product: 'link' },
  { slug: 'ai-ad-copy-generator', group: 'marketing', accent: 'agents', product: 'crm', ai: true },
  { slug: 'business-name-generator', group: 'marketing', accent: 'flow', product: 'link', ai: true },
  { slug: 'blog-ideas-generator', group: 'marketing', accent: 'docs', product: 'docs', ai: true },
  { slug: 'invoice-generator', group: 'finance', accent: 'crm', product: 'crm' },
  { slug: 'saas-cost-calculator', group: 'finance', accent: 'track', product: null },
  { slug: 'privacy-policy-generator', group: 'finance', accent: 'docs', product: 'docs' },
  { slug: 'website-grader', group: 'website', accent: 'board', product: 'link', server: true },
];

export const TOOL_SLUGS: readonly string[] = TOOLS.map((t) => t.slug);

export function getTool(slug: string): ToolDef | null {
  return TOOLS.find((t) => t.slug === slug) ?? null;
}

/** Otras herramientas para "También te puede servir": mismo grupo primero. */
export function relatedTools(slug: string, max = 3): ToolDef[] {
  const tool = getTool(slug);
  if (!tool) return [];
  const same = TOOLS.filter((t) => t.slug !== slug && t.group === tool.group);
  const rest = TOOLS.filter((t) => t.slug !== slug && t.group !== tool.group);
  return [...same, ...rest].slice(0, max);
}

const LOCALES = ['en', 'es', 'pt'] as const;

/** canonical + hreflang para una ruta del sitio (path sin locale, ej. "/tools"). */
export function localizedAlternates(path: string, locale: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, `/${l}${path}`])),
      'x-default': `/en${path}`,
    },
  };
}

/** JSON-LD seguro para <script>: escapa "<" para que no cierre la etiqueta. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** URL absoluta del sitio (sitemap, JSON-LD). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://zerosoft.ai').replace(/\/$/, '');
}
