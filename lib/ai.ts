import {
  generateText,
  Output,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import type { z } from 'zod';
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
  return resolveAiModel();
}

/**
 * Modelo a usar. `preferredId` ("proveedor/modelo", p. ej. el override de un
 * agente) gana sobre AI_MODEL; el modelo inyectado en tests gana sobre todo.
 */
export function resolveAiModel(preferredId?: string | null): { model: LanguageModel; modelId: string } {
  if (modelOverride) {
    const id = typeof modelOverride === 'string' ? modelOverride : modelOverride.modelId;
    return { model: modelOverride, modelId: id };
  }
  const id = preferredId?.trim() || aiModelId();
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
  await assertAiQuota(workspaceId);
}

/**
 * Cuota del mes y rate limit (sin mirar si hay proveedor configurado). La usan
 * assertAiAvailable y los modelos falsos de e2e (lib/crm-ai-fake.ts), que no
 * necesitan Gateway pero sí tienen que medir y limitar igual.
 */
export async function assertAiQuota(workspaceId: string): Promise<void> {
  await assertAiMonthlyQuota(workspaceId);
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const res = await rateLimit(`ai:${workspaceId}`, aiRateLimitPerMinute(), 60);
    if (!res.ok) throw new AiError('rate_limited');
  }
}

/**
 * Solo la cuota del mes (sin rate limit). La usa la transcripción de Voice,
 * que tiene su propio rate limit por workspace (los trozos de una reunión no
 * compiten con el chat ni con las notas).
 */
export async function assertAiMonthlyQuota(workspaceId: string): Promise<void> {
  const free = aiFreeTokensPerMonth();
  if (free !== null) {
    const usage = await getAiUsage(workspaceId);
    if (usage.totalTokens >= free) throw new AiError('quota_exceeded');
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

export interface AiObjectOptions<T> extends Omit<AiCallOptions, 'workspaceId'> {
  /**
   * Workspace que paga la llamada. null = tarea de sistema de la instancia
   * (sin workspace dueño): no hay cuota ni registro en ai_usage, solo el rate
   * limit con la clave `ai:system:<feature>`.
   */
  workspaceId: string | null;
  schema: z.ZodType<T>;
  /** Nombre del objeto para el modelo (opcional). */
  schemaName?: string;
}

export interface AiObjectResult<T> {
  object: T;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Salida estructurada (generateText + Output.object con un schema zod). El
 * SDK valida el objeto contra el schema; si el modelo no cumple, tira.
 */
export async function aiGenerateObject<T>(opts: AiObjectOptions<T>): Promise<AiObjectResult<T>> {
  if (opts.workspaceId) {
    await assertAiAvailable(opts.workspaceId);
  } else {
    if (!aiEnabled()) throw new AiError('ai_disabled');
    if (process.env.RATE_LIMIT_DISABLED !== 'true') {
      const res = await rateLimit(`ai:system:${opts.feature}`, aiRateLimitPerMinute(), 60);
      if (!res.ok) throw new AiError('rate_limited');
    }
  }
  const { model, modelId } = resolveModel();
  const result = await generateText({
    model,
    ...callSettings({ ...opts, workspaceId: opts.workspaceId ?? '' }),
    output: Output.object({ schema: opts.schema, name: opts.schemaName }),
  });
  const usage = result.totalUsage;
  if (opts.workspaceId) await recordFromUsage(opts.workspaceId, opts.feature, modelId, usage);
  return {
    object: result.output as T,
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

// ---------- Transcripción ----------

/**
 * Proveedor de transcripción (audio → texto). Por defecto el mismo AI Gateway
 * que el resto de la IA (AI_TRANSCRIBE_MODEL, por defecto `openai/whisper-1`,
 * con experimental_transcribe del AI SDK): no hace falta otra key. Con
 * AI_TRANSCRIBE_API_KEY se usa en cambio una API compatible con
 * POST /v1/audio/transcriptions de OpenAI (AI_TRANSCRIBE_URL), por ejemplo un
 * Whisper propio en self-host.
 */
export function transcriptionConfig(): { kind: 'gateway'; model: string } | { kind: 'http'; url: string; key: string; model: string } | null {
  if (process.env.AI_ENABLED === 'false') return null;
  const key = process.env.AI_TRANSCRIBE_API_KEY?.trim();
  if (key) {
    return {
      kind: 'http',
      url: process.env.AI_TRANSCRIBE_URL?.trim() || 'https://api.openai.com/v1/audio/transcriptions',
      key,
      model: process.env.AI_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe',
    };
  }
  if (!aiEnabled()) return null;
  return { kind: 'gateway', model: process.env.AI_TRANSCRIBE_MODEL?.trim() || 'openai/whisper-1' };
}

export interface AiTranscribeOptions {
  workspaceId: string;
  feature: string;
  audio: Blob;
  filename: string;
  /** Duración del trozo (segundos), para el registro de uso. */
  seconds: number;
  /** Código ISO del idioma, si se sabe (mejora la precisión). */
  language?: string;
  /** e2e: respuesta fija sin proveedor (mide cuota y uso igual). */
  fake?: () => string;
}

/**
 * Transcribe un trozo de audio. El uso se registra en ai_usage como tokens
 * estimados (10 por segundo de audio de entrada, texto/4 de salida): la
 * cuota del workspace los cuenta igual que el resto de la IA.
 */
export async function aiTranscribe(opts: AiTranscribeOptions): Promise<{ text: string; model: string }> {
  const seconds = Math.max(0, Math.min(Math.round(opts.seconds), 3600));
  if (opts.fake) {
    await assertAiQuota(opts.workspaceId);
    const text = opts.fake();
    await recordAiUsage({ workspaceId: opts.workspaceId, feature: opts.feature, model: 'transcribe-fake', inputTokens: seconds * 10, outputTokens: Math.ceil(text.length / 4) });
    return { text, model: 'transcribe-fake' };
  }
  const cfg = transcriptionConfig();
  if (!cfg) throw new AiError('ai_disabled');
  await assertAiQuota(opts.workspaceId);
  let text: string;
  if (cfg.kind === 'gateway') {
    const { experimental_transcribe, gateway } = await import('ai');
    const res = await experimental_transcribe({
      model: gateway.transcriptionModel(cfg.model),
      audio: new Uint8Array(await opts.audio.arrayBuffer()),
      ...(opts.language ? { providerOptions: { openai: { language: opts.language.slice(0, 5) } } } : {}),
      abortSignal: AbortSignal.timeout(120_000),
    });
    text = res.text.trim();
  } else {
    const form = new FormData();
    form.set('file', opts.audio, opts.filename);
    form.set('model', cfg.model);
    form.set('response_format', 'json');
    if (opts.language) form.set('language', opts.language.slice(0, 5));
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429) throw new AiError('rate_limited');
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`transcribe_http_${res.status}`);
    }
    const data = (await res.json()) as { text?: string };
    text = String(data.text ?? '').trim();
  }
  await recordAiUsage({ workspaceId: opts.workspaceId, feature: opts.feature, model: `transcribe:${cfg.model}`, inputTokens: seconds * 10, outputTokens: Math.ceil(text.length / 4) });
  return { text, model: cfg.model };
}
