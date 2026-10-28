/**
 * Link: IA para analizar links (como Bitly Assist). Responde preguntas sobre
 * el rendimiento de los links del workspace a partir de las mismas analytics
 * que ve la persona (rango, filtros y carpetas visibles): clicks, escaneos,
 * leads, ventas, países, dispositivos y top links. Todo pasa por lib/ai.ts
 * (cuota, rate limit y ai_usage). Crear links con IA va por el servidor MCP.
 *
 * En e2e (LINK_AI_FAKE=1, nunca en un deploy de producción) corre contra el
 * modelo falso de lib/crm-ai-fake.ts; la cookie link_ai_fake=off simula la IA
 * apagada (error ai_disabled). Server-only.
 */
import { generateText, type LanguageModel } from 'ai';
import { AiError, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel, type FakeCallInfo, type FakeStep } from './crm-ai-fake';
import {
  getWorkspaceAnalytics,
  getWorkspaceConversions,
  type WorkspaceAnalytics,
  type WorkspaceAnalyticsOptions,
  type WorkspaceConversions,
  type WorkspaceRange,
} from './link-analytics';

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

async function fakeState(): Promise<'on' | 'off' | null> {
  if (process.env.LINK_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return null;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('link_ai_fake')?.value === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

async function linkModel(ws: string, fake: (info: FakeCallInfo) => FakeStep): Promise<{ model: LanguageModel; modelId: string }> {
  const state = await fakeState();
  if (state === 'on') {
    await assertAiQuota(ws);
    return { model: fakeModel(fake), modelId: 'link-fake' };
  }
  if (state === 'off') throw new AiError('ai_disabled');
  await assertAiAvailable(ws);
  return resolveAiModel();
}

/** Resumen compacto de las analytics para el modelo (sin datos personales). */
export function analyticsContext(a: WorkspaceAnalytics, c: WorkspaceConversions): string {
  const top = (items: Array<{ name: string; count: number }>) => items.slice(0, 8).map((i) => `${i.name}: ${i.count}`).join(', ') || 'none';
  const busiest = [...a.byDay].sort((x, y) => y.clicks + y.scans - (x.clicks + x.scans))[0];
  return [
    `Range: ${a.range.from} to ${a.range.to} (${a.timezone}).`,
    `Filters: ${JSON.stringify(a.filters)}.`,
    `Clicks: ${a.clicks} (previous period ${a.previous.clicks}). QR scans: ${a.scans} (previous ${a.previous.scans}).`,
    `Leads: ${c.leads} (previous ${c.previous.leads}). Sales: ${c.sales} (previous ${c.previous.sales}). Revenue (minor units): ${
      c.revenue.map((r) => `${r.amount} ${r.currency}`).join(', ') || 'none'
    }.`,
    busiest && busiest.clicks + busiest.scans > 0 ? `Busiest day: ${busiest.date} with ${busiest.clicks + busiest.scans} visits.` : '',
    `Daily visits: ${a.byDay.map((d) => `${d.date}=${d.clicks + d.scans}`).join(' ')}.`,
    `Top links by clicks: ${a.topLinks.map((l) => `${l.short_url} (${l.title ?? l.url}): ${l.clicks} clicks, ${l.scans} scans`).join('; ') || 'none'}.`,
    `Top links by conversions: ${c.topLinks.map((l) => `${l.short_url}: ${l.leads} leads, ${l.sales} sales, revenue ${l.revenue}`).join('; ') || 'none'}.`,
    `Referrers: ${top(a.referrers)}.`,
    `Countries (ISO codes): ${top(a.countries)}.`,
    `Cities: ${top(a.cities)}.`,
    `Devices: ${top(a.devices)}.`,
    `Browsers: ${top(a.browsers)}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Respuesta del modelo falso: el dato pedido, armado con el mismo contexto. */
function fakeAnswer(info: FakeCallInfo): string {
  const question = info.userTexts[info.userTexts.length - 1] ?? '';
  const clicks = /Clicks: (\d+)/.exec(question)?.[1] ?? '0';
  const topLink = /Top links by clicks: ([^\s(;]+)/.exec(question)?.[1];
  return topLink && topLink !== 'none.'
    ? `You had ${clicks} clicks in this range. The link with the most clicks was ${topLink}.`
    : `You had ${clicks} clicks in this range.`;
}

export interface AskLinksInput {
  ws: string;
  question: string;
  locale: string;
  range: WorkspaceRange;
  opts: WorkspaceAnalyticsOptions;
}

/** Respuesta en texto plano (2 a 6 oraciones) a una pregunta sobre las analytics. */
export async function askLinksAnalytics(input: AskLinksInput): Promise<string> {
  const question = input.question.trim().slice(0, 500);
  if (!question) throw new AiError('ai_disabled');
  const [a, c] = await Promise.all([
    getWorkspaceAnalytics(input.ws, input.range, input.opts),
    getWorkspaceConversions(input.ws, input.range, input.opts),
  ]);
  const context = analyticsContext(a, c);
  const { model, modelId } = await linkModel(input.ws, (info) => ({ text: fakeAnswer(info) }));
  const result = await generateText({
    model,
    instructions: [
      'You answer questions about the short-link analytics of a small team, using only the data provided.',
      `Answer in ${LOCALE_NAME[input.locale] ?? 'English'}, in 2 to 6 short sentences of plain text (no markdown tables).`,
      'Quote the exact numbers. If the data does not answer the question, say what is missing. Do not invent links, numbers or causes.',
      'Revenue is in minor units (cents): divide by 100 when you mention it, except for zero-decimal currencies.',
    ].join(' '),
    prompt: `${context}\n\nQuestion: ${question}`,
    maxOutputTokens: 500,
    temperature: 0.2,
    timeout: 30_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: input.ws,
    feature: 'link_analytics',
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return result.text.trim();
}
