/**
 * Analytics — preguntar en lenguaje natural: el modelo escribe el SQL sobre
 * el esquema que la persona puede ver, y la app siempre lo muestra antes de
 * correrlo (pasa por los mismos controles que el SQL escrito a mano).
 *
 * Todo va por lib/ai.ts (cuota, rate limit y ai_usage). En e2e, BI_AI_FAKE=1
 * usa el modelo falso de lib/crm-ai-fake.ts con un SQL armado por una
 * heurística; la cookie bi_ai_fake=off se comporta como sin IA. Nunca se
 * activa en producción de Vercel. Server-only.
 */
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { AiError, aiEnabled, assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from '../ai';
import { fakeModel } from '../crm-ai-fake';
import type { Dialect, SchemaTable } from './types';

async function fakeCookieOff(): Promise<boolean> {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('bi_ai_fake')?.value === 'off';
  } catch {
    return false;
  }
}

async function fakeActive(): Promise<boolean> {
  if (process.env.BI_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return false;
  return !(await fakeCookieOff());
}

export async function biAiAvailable(): Promise<boolean> {
  if (await fakeActive()) return true;
  if (process.env.BI_AI_FAKE === '1') return false;
  return aiEnabled();
}

const answerSchema = z.object({
  sql: z.string().min(1).max(8000),
  title: z.string().max(120),
  explanation: z.string().max(600),
});
export type AskAnswer = z.infer<typeof answerSchema>;

const DIALECT_NAME: Record<Dialect, string> = { sqlite: 'SQLite', postgres: 'PostgreSQL', mysql: 'MySQL' };
const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

export function schemaPrompt(schema: SchemaTable[]): string {
  return schema
    .slice(0, 120)
    .map((t) => `${t.name}(${t.columns.slice(0, 60).map((c) => `${c.name} ${c.type}`).join(', ')})`)
    .join('\n');
}

/** Heurística del modelo falso: cuenta filas de la tabla nombrada en la pregunta, por mes si pide tiempo. */
export function fakeAnswer(question: string, schema: SchemaTable[]): AskAnswer {
  const q = question.toLowerCase();
  const table = schema.find((t) => q.includes(t.name.toLowerCase().replace(/s$/, ''))) ?? schema[0];
  if (!table) return { sql: 'SELECT 1 AS value', title: 'Value', explanation: 'No tables available.' };
  const date = table.columns.find((c) => c.name === 'created_at') ?? table.columns.find((c) => c.type === 'date');
  if (date && /(month|mes|mês|time|tiempo|tempo|trend)/.test(q)) {
    return {
      sql: `SELECT strftime('%Y-%m-01', ${date.name}) AS month, COUNT(*) AS count FROM ${table.name} GROUP BY 1 ORDER BY 1`,
      title: `${table.name} by month`,
      explanation: `Counts rows of ${table.name} per month of ${date.name}.`,
    };
  }
  return { sql: `SELECT COUNT(*) AS count FROM ${table.name}`, title: `Number of ${table.name}`, explanation: `Counts every row of ${table.name}.` };
}

async function pickModel(workspaceId: string, fake: () => string): Promise<{ model: LanguageModel; modelId: string }> {
  if (await fakeActive()) {
    await assertAiQuota(workspaceId);
    return { model: fakeModel(() => ({ text: fake() })), modelId: 'bi-fake' };
  }
  if (process.env.BI_AI_FAKE === '1') throw new AiError('ai_disabled');
  await assertAiAvailable(workspaceId);
  return resolveAiModel();
}

export async function askSql(opts: { workspaceId: string; question: string; schema: SchemaTable[]; dialect: Dialect; locale: string }): Promise<AskAnswer> {
  const { model, modelId } = await pickModel(opts.workspaceId, () => JSON.stringify(fakeAnswer(opts.question, opts.schema)));
  const instructions = [
    `You write one read-only ${DIALECT_NAME[opts.dialect]} SELECT query that answers the question.`,
    'Use only the tables and columns listed. Never write INSERT, UPDATE, DELETE, DDL, comments or more than one statement.',
    opts.dialect === 'sqlite'
      ? 'Do not quote identifiers. Dates are text like 2026-01-31 13:45:00; use date(), strftime() and datetime(). Join only contacts.company_id = companies.id, issues.project_id = projects.id or messages.chat_id = chats.id, at most three tables.'
      : 'Quote identifiers only when needed.',
    'Give short column aliases in snake_case. Add ORDER BY when the order matters and LIMIT 1000 for row lists.',
    `Write title and explanation in ${LOCALE_NAME[opts.locale] ?? 'English'}. The explanation says in one or two sentences what the query counts or lists.`,
  ].join('\n');
  const result = await generateText({
    model,
    instructions,
    prompt: `Tables:\n${schemaPrompt(opts.schema)}\n\nQuestion: ${opts.question.slice(0, 1000)}`,
    output: Output.object({ schema: answerSchema }),
    maxOutputTokens: 900,
    temperature: 0,
    timeout: 45_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: opts.workspaceId,
    feature: 'bi_ask',
    model: modelId,
    inputTokens: result.totalUsage?.inputTokens ?? 0,
    outputTokens: result.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return result.output as AskAnswer;
}
