/**
 * Tableros armados: sitio web, salud del producto y métricas de LLM, como los
 * oficiales de PostHog. Crear uno genera sus insights en el proyecto, que después
 * se editan como cualquier otro.
 */

import { insightQuerySchema, type InsightQuery } from './types';

export const DASHBOARD_TEMPLATES = ['website', 'product', 'llm'] as const;
export type DashboardTemplate = (typeof DASHBOARD_TEMPLATES)[number];
type Locale = 'en' | 'es' | 'pt';
type Names = Record<Locale, string>;

interface TemplateInsight {
  name: Names;
  query: Record<string, unknown>;
}

const trend = (event: string, math: string, extra: Record<string, unknown> = {}, mathProperty?: string) => ({
  kind: 'trends',
  series: [{ event, math, ...(mathProperty ? { mathProperty } : {}) }],
  dateRange: { from: '-30d' },
  interval: 'day',
  ...extra,
});

const TEMPLATES: Record<DashboardTemplate, { name: Names; insights: TemplateInsight[] }> = {
  website: {
    name: { en: 'Website', es: 'Sitio web', pt: 'Site' },
    insights: [
      { name: { en: 'Pageviews', es: 'Páginas vistas', pt: 'Páginas vistas' }, query: trend('$pageview', 'total') },
      { name: { en: 'Unique visitors', es: 'Visitantes únicos', pt: 'Visitantes únicos' }, query: trend('$pageview', 'unique') },
      { name: { en: 'Sessions', es: 'Sesiones', pt: 'Sessões' }, query: trend('$pageview', 'sessions') },
      { name: { en: 'Top pages', es: 'Páginas más vistas', pt: 'Páginas mais vistas' }, query: trend('$pageview', 'total', { display: 'bar_total', breakdown: { key: '$pathname', type: 'event' } }) },
      { name: { en: 'Top referrers', es: 'De dónde llegan', pt: 'De onde chegam' }, query: trend('$pageview', 'unique', { display: 'bar_total', breakdown: { key: '$referring_domain', type: 'event' } }) },
      { name: { en: 'Devices', es: 'Dispositivos', pt: 'Dispositivos' }, query: trend('$pageview', 'unique', { display: 'pie', breakdown: { key: '$device_type', type: 'event' } }) },
    ],
  },
  product: {
    name: { en: 'Product health', es: 'Salud del producto', pt: 'Saúde do produto' },
    insights: [
      { name: { en: 'Daily active people', es: 'Personas activas por día', pt: 'Pessoas ativas por dia' }, query: trend('*', 'unique') },
      { name: { en: 'Weekly active people', es: 'Personas activas por semana', pt: 'Pessoas ativas por semana' }, query: trend('*', 'wau') },
      { name: { en: 'Monthly active people', es: 'Personas activas por mes', pt: 'Pessoas ativas por mês' }, query: trend('*', 'mau') },
      { name: { en: 'Growth', es: 'Crecimiento', pt: 'Crescimento' }, query: { kind: 'lifecycle', event: '$pageview', interval: 'week', dateRange: { from: '-90d' } } },
      { name: { en: 'Retention', es: 'Retención', pt: 'Retenção' }, query: { kind: 'retention', startEvent: '$pageview', returnEvent: '$pageview', period: 'week', periods: 8 } },
      { name: { en: 'Stickiness', es: 'Stickiness', pt: 'Stickiness' }, query: { kind: 'stickiness', series: [{ event: '$pageview' }], interval: 'day', dateRange: { from: '-30d' } } },
    ],
  },
  llm: {
    name: { en: 'LLM metrics', es: 'Métricas de LLM', pt: 'Métricas de LLM' },
    insights: [
      { name: { en: 'Generations', es: 'Generaciones', pt: 'Gerações' }, query: trend('$ai_generation', 'total') },
      { name: { en: 'People using AI', es: 'Personas que usan AI', pt: 'Pessoas usando AI' }, query: trend('$ai_generation', 'unique') },
      { name: { en: 'Cost', es: 'Costo', pt: 'Custo' }, query: trend('$ai_generation', 'sum', { options: { unit: 'currency' } }, '$ai_total_cost_usd') },
      { name: { en: 'Latency p95', es: 'Latencia p95', pt: 'Latência p95' }, query: trend('$ai_generation', 'p95', { options: { unit: 'duration' } }, '$ai_latency') },
      { name: { en: 'Generations by model', es: 'Generaciones por modelo', pt: 'Gerações por modelo' }, query: trend('$ai_generation', 'total', { display: 'bar_total', breakdown: { key: '$ai_model', type: 'event' } }) },
    ],
  },
};

const loc = (locale: string): Locale => (locale === 'es' || locale === 'pt' ? locale : 'en');

/** Nombre y consultas ya validadas de un tablero armado, en el idioma de quien lo crea. */
export function templateContent(template: DashboardTemplate, locale: string): { name: string; insights: Array<{ name: string; query: InsightQuery }> } {
  const l = loc(locale);
  const t = TEMPLATES[template];
  return { name: t.name[l], insights: t.insights.map((i) => ({ name: i.name[l], query: insightQuerySchema.parse(i.query) })) };
}
