/**
 * Agents — configuración compartida entre servidor y cliente (sin imports de
 * servidor): claves de herramientas, schemas zod de la configuración, valores
 * por defecto y plantillas.
 */
import { z } from 'zod';

export const AGENT_TOOL_KEYS = [
  'search_knowledge',
  'crm_find_contact',
  'crm_upsert_contact',
  'crm_log_note',
  'cal_get_availability',
  'cal_book_meeting',
  'track_create_issue',
  'run_flow',
  'handoff_to_human',
  'http_request',
] as const;

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number];

/** Grupo de cada herramienta (para agrupar en la UI). */
export const AGENT_TOOL_GROUP: Record<AgentToolKey, 'knowledge' | 'crm' | 'cal' | 'track' | 'flow' | 'handoff' | 'http'> = {
  search_knowledge: 'knowledge',
  crm_find_contact: 'crm',
  crm_upsert_contact: 'crm',
  crm_log_note: 'crm',
  cal_get_availability: 'cal',
  cal_book_meeting: 'cal',
  track_create_issue: 'track',
  run_flow: 'flow',
  handoff_to_human: 'handoff',
  http_request: 'http',
};

/** Máximo de pasos (llamadas al modelo) por respuesta. */
export const AGENT_MAX_STEPS = 6;
export const AGENT_MAX_URLS = 20;
export const AGENT_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
/** "proveedor/modelo" del AI Gateway. */
export const AGENT_MODEL_RE = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const id = z.string().trim().min(1).max(100);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))
  .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/));

export const knowledgeConfigSchema = z.object({
  allPublicDocs: z.boolean().default(true),
  docsPageIds: z.array(id).max(200).default([]),
  urls: z.array(z.string().trim().url().max(2000)).max(AGENT_MAX_URLS).default([]),
  cannedFromWidgetId: id.nullable().default(null),
});

export const toolsConfigSchema = z.object({
  enabled: z.array(z.enum(AGENT_TOOL_KEYS)).max(AGENT_TOOL_KEYS.length).default(['search_knowledge', 'handoff_to_human']),
  calEventTypeId: id.nullable().default(null),
  calDays: z.number().int().min(1).max(30).default(7),
  trackProjectId: id.nullable().default(null),
  flowIds: z.array(id).max(20).default([]),
  httpAllowedDomains: z.array(domain).max(20).default([]),
});

export const handoffConfigSchema = z.object({
  onRequest: z.boolean().default(true),
  onUnsure: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(2).max(60)).max(30).default([]),
  message: z.string().trim().max(500).default(''),
});

export const guardrailsConfigSchema = z.object({
  avoidTopics: z.array(z.string().trim().min(2).max(120)).max(30).default([]),
  maxReplyChars: z.number().int().min(100).max(4000).default(800),
});

export type AgentKnowledgeConfig = z.infer<typeof knowledgeConfigSchema>;
export type AgentToolsConfig = z.infer<typeof toolsConfigSchema>;
export type AgentHandoffConfig = z.infer<typeof handoffConfigSchema>;
export type AgentGuardrailsConfig = z.infer<typeof guardrailsConfigSchema>;

export const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  emoji: z.string().trim().max(8).optional(),
  instructions: z.string().max(12_000).optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  model: z.string().trim().max(120).regex(AGENT_MODEL_RE).nullable().or(z.literal('')).optional(),
  temperature: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
  publicHandle: z.string().trim().toLowerCase().regex(AGENT_HANDLE_RE).nullable().or(z.literal('')).optional(),
  knowledge: knowledgeConfigSchema.optional(),
  tools: toolsConfigSchema.optional(),
  handoff: handoffConfigSchema.optional(),
  guardrails: guardrailsConfigSchema.optional(),
});

export type AgentUpdatePayload = z.infer<typeof agentUpdateSchema>;

export const AGENT_TEMPLATE_KEYS = ['support', 'sdr', 'qualifier'] as const;
export type AgentTemplateKey = (typeof AGENT_TEMPLATE_KEYS)[number];

export const agentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  template: z.enum(AGENT_TEMPLATE_KEYS).optional(),
  instructions: z.string().max(12_000).optional(),
});

/** Herramientas y emoji por defecto de cada plantilla (las instrucciones vienen de i18n). */
export const AGENT_TEMPLATES: Record<AgentTemplateKey, { emoji: string; tools: AgentToolKey[] }> = {
  support: { emoji: '🛟', tools: ['search_knowledge', 'crm_find_contact', 'track_create_issue', 'handoff_to_human'] },
  sdr: {
    emoji: '📅',
    tools: ['search_knowledge', 'crm_upsert_contact', 'cal_get_availability', 'cal_book_meeting', 'handoff_to_human'],
  },
  qualifier: {
    emoji: '🎯',
    tools: ['search_knowledge', 'crm_find_contact', 'crm_upsert_contact', 'crm_log_note', 'handoff_to_human'],
  },
};

function parseWith<S extends z.ZodTypeAny>(schema: S, raw: string | null | undefined): z.output<S> {
  let value: unknown = {};
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    value = {};
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Config vieja o corrupta: se queda con los defaults.
  return schema.parse({});
}

export const parseKnowledge = (raw: string | null | undefined) => parseWith(knowledgeConfigSchema, raw);
export const parseTools = (raw: string | null | undefined) => parseWith(toolsConfigSchema, raw);
export const parseHandoff = (raw: string | null | undefined) => parseWith(handoffConfigSchema, raw);
export const parseGuardrails = (raw: string | null | undefined) => parseWith(guardrailsConfigSchema, raw);

/** Agente listo para la UI (JSON parseado, camelCase). */
export interface AgentDto {
  id: string;
  name: string;
  emoji: string;
  instructions: string;
  welcomeMessage: string;
  model: string | null;
  temperature: number;
  knowledge: AgentKnowledgeConfig;
  tools: AgentToolsConfig;
  handoff: AgentHandoffConfig;
  guardrails: AgentGuardrailsConfig;
  enabled: boolean;
  publicHandle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListItem extends AgentDto {
  conversations7d: number;
  thumbsUp: number;
  thumbsDown: number;
  channels: Array<'chat' | 'public' | 'api'>;
}

export interface AgentToolCallDto {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number;
  runId: string;
  createdAt: string;
}

export interface AgentMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  runId: string | null;
  createdAt: string;
  rating?: number | null;
  note?: string;
}

export interface AgentConversationDto {
  id: string;
  channel: 'playground' | 'public' | 'api' | 'chat';
  title: string;
  handedOff: boolean;
  chatConversationId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

/** Eventos del stream NDJSON de una respuesta (playground y página pública). */
export type AgentStreamEvent =
  | { type: 'start'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; id: string; tool: string; input: unknown }
  | { type: 'tool-end'; id: string; tool: string; output: unknown; error: string | null; durationMs: number }
  | { type: 'done'; messageId: string | null; text: string; status: string; handoff: boolean }
  | { type: 'error'; code: string };
