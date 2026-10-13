import {
  generateText,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import { getDb } from './db';
import { rateLimit } from './rate-limit';

/**
 * Base de AI de la suite. Todas las llamadas a modelos pasan por acá:
 * - Vercel AI SDK con strings "proveedor/modelo", que van por Vercel AI
 *   Gateway (AI_GATEWAY_API_KEY, o OIDC en deploys de Vercel).
 * - Cuota mensual gratis por workspace (AI_FREE_TOKENS_PER_MONTH) y rate
 *   limit por workspace antes de cada llamada.
 * - Cada llamada registra su consumo en ai_usage (base de la facturación en la
 *   nube: tokens × 1.2 pasada la cuota; por ahora solo se mide).
 * En self-host el dueño pone su propia key y puede apagar la cuota con
 * AI_FREE_TOKENS_PER_MONTH=unlimited.
 *
 * "Workspace" = user_id del dueño (como el resto de las tablas).
 */

export const DEFAULT_AI_MODEL = 'anthropic/claude-sonnet-5-5';
export const DEFAULT_FREE_TOKENS_PER_MONTH = 200_000;
/** Markup de la nube sobre el costo de tokens pasada la cuota gratis. */
export const AI_CLOUD_MARKUP = 1.2;

export type AiErrorCode = 'ai_disabled' | 'quota_exceeded' | 'rate_limited';

export class AiError extends Error {
  constructor(public code: AiErrorCode) {
    super(code);
    this.name = 'AiError';
  }
}

// ---------- Configuración ----------

let modelOverride: LanguageModel | null = null;

/**
 * Inyecta un modelo (p. ej. MockLanguageModelV4 de 'ai/test') para tests.
 * Con un modelo inyectado la AI se considera configurada. null lo quita.
 */
export function setAiModelOverride(model: LanguageModel | null): void {
  modelOverride = model;
}

export function aiModelId(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

/**
 * La AI está disponible si hay key del Gateway, token OIDC, o corre en Vercel
 * (el Gateway usa el OIDC del deploy). AI_ENABLED=false la apaga siempre.
 */
export function aiEnabled(): boolean {
  if (modelOverride) return true;
  if (process.env.AI_ENABLED === 'false') return false;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || process.env.VERCEL === '1',
  );
}

/** Tokens gratis por workspace y mes. null = sin límite (self-host). */
export function aiFreeTokensPerMonth(): number | null {
  const raw = process.env.AI_FREE_TOKENS_PER_MONTH?.trim().toLowerCase();
  if (!raw) return DEFAULT_FREE_TOKENS_PER_MONTH;
  if (raw === 'unlimited' || raw === '-1') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_FREE_TOKENS_PER_MONTH;
}

function aiRateLimitPerMinute(): number {
  const n = Number(process.env.AI_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

function resolveModel(): { model: LanguageModel; modelId: string } {
  if (modelOverride) {
    const id = typeof modelOverride === 'string' ? modelOverride : modelOverride.modelId;
    return { model: modelOverride, modelId: id };
  }
  const id = aiModelId();
  return { model: id, modelId: id };
}

// ---------- Consumo ----------

/** Inicio del mes calendario (UTC) en ISO. */
export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export interface AiUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** null = sin límite. */
  freeTokens: number | null;
  /** Tokens por encima de la cuota gratis (facturables en la nube). */
  overageTokens: number;
  periodStart: string;
  byFeature: Array<{ feature: string; tokens: number }>;
}

export async function getAiUsage(workspaceId: string, now = new Date()): Promise<AiUsageSummary> {
  const since = monthStartIso(now);
  const rows = (await getDb()
    .prepare(
      `SELECT feature, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
       FROM ai_usage WHERE user_id = ? AND created_at >= ? GROUP BY feature ORDER BY feature`,
    )
    .all(workspaceId, since)) as Array<{ feature: string; input: number; output: number }>;
  let inputTokens = 0;
  let outputTokens = 0;
  const byFeature = rows.map((r) => {
    inputTokens += Number(r.input);
    outputTokens += Number(r.output);
    return { feature: r.feature, tokens: Number(r.input) + Number(r.output) };
  });
  const totalTokens = inputTokens + outputTokens;
  const freeTokens = aiFreeTokensPerMonth();
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    freeTokens,
    overageTokens: freeTokens === null ? 0 : Math.max(0, totalTokens - freeTokens),
    periodStart: since,
    byFeature,
  };
}

export async function recordAiUsage(entry: {
  workspaceId: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await getDb()
    .prepare(
      'INSERT INTO ai_usage (id, user_id, feature, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      crypto.randomUUID(),
      entry.workspaceId,
      entry.feature,
      entry.model,
      Math.max(0, Math.round(entry.inputTokens)),
      Math.max(0, Math.round(entry.outputTokens)),
      new Date().toISOString(),
    );
}

async function recordFromUsage(
  workspaceId: string,
  feature: string,
  modelId: string,
  usage: LanguageModelUsage | undefined,
): Promise<void> {
  await recordAiUsage({
    workspaceId,
    feature,
    model: modelId,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  });
}

/**
 * Verifica que se pueda llamar al modelo para este workspace. Tira AiError si
 * la AI no está configurada, si se agotó la cuota del mes o si superó el rate
 * limit. La cuota se chequea antes de la llamada (puede pasarse por una
 * llamada en vuelo; es aceptable).
 */
export async function assertAiAvailable(workspaceId: string): Promise<void> {
  if (!aiEnabled()) throw new AiError('ai_disabled');
  const free = aiFreeTokensPerMonth();
  if (free !== null) {
    const usage = await getAiUsage(workspaceId);
    if (usage.totalTokens >= free) throw new AiError('quota_exceeded');
  }
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const res = await rateLimit(`ai:${workspaceId}`, aiRateLimitPerMinute(), 60);
    if (!res.ok) throw new AiError('rate_limited');
  }
}

// ---------- Wrappers ----------

export interface AiCallOptions {
  workspaceId: string;
  /** Feature que consume (p. ej. 'chat_bot'), para el desglose de uso. */
  feature: string;
  instructions?: string;
  prompt?: string;
  messages?: ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
  /** Timeout total en ms (default 30s). */
  timeoutMs?: number;
}

function callSettings(opts: AiCallOptions) {
  const base = {
    instructions: opts.instructions,
    maxOutputTokens: opts.maxOutputTokens,
    temperature: opts.temperature,
    abortSignal: opts.abortSignal,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: 1,
  };
  if (opts.messages) return { ...base, messages: opts.messages };
  return { ...base, prompt: opts.prompt ?? '' };
}

export interface AiTextResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export async function aiGenerateText(opts: AiCallOptions): Promise<AiTextResult> {
  await assertAiAvailable(opts.workspaceId);
  const { model, modelId } = resolveModel();
  const result = await generateText({ model, ...callSettings(opts) });
  const usage = result.totalUsage;
  await recordFromUsage(opts.workspaceId, opts.feature, modelId, usage);
  return {
    text: result.text,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    model: modelId,
  };
}

/**
 * streamText con cuota y registro de uso al terminar. Devuelve el resultado
 * del SDK (textStream, toUIMessageStreamResponse, etc.).
 */
export async function aiStreamText(opts: AiCallOptions) {
  await assertAiAvailable(opts.workspaceId);
  const { model, modelId } = resolveModel();
  return streamText({
    model,
    ...callSettings(opts),
    onEnd: async ({ totalUsage }) => {
      await recordFromUsage(opts.workspaceId, opts.feature, modelId, totalUsage).catch(() => {});
    },
  });
}
