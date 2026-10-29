/**
 * Agents — configuración compartida entre servidor y cliente (sin imports de
 * servidor): claves de herramientas, schemas zod de la configuración, valores
 * por defecto y plantillas.
 */
import { z } from 'zod';

export const AGENT_TOOL_KEYS = [
  'search_knowledge',
  'docs_read_pages',
  'docs_write_page',
  'docs_write_row',
  'crm_find_contact',
  'crm_upsert_contact',
  'crm_log_note',
  'cal_get_availability',
  'cal_book_meeting',
  'track_create_issue',
  'run_flow',
  'run_robot',
  'handoff_to_human',
  'http_request',
  'mcp_call',
  'show_buttons',
  'show_form',
  'run_code',
  'stripe_customer',
  'shopify_order',
  'shopify_products',
] as const;

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number];

/** Grupo de cada herramienta (para agrupar en la UI). */
export const AGENT_TOOL_GROUP: Record<
  AgentToolKey,
  'knowledge' | 'crm' | 'cal' | 'track' | 'flow' | 'robots' | 'handoff' | 'http' | 'mcp' | 'code' | 'commerce'
> = {
  search_knowledge: 'knowledge',
  docs_read_pages: 'knowledge',
  docs_write_page: 'knowledge',
  docs_write_row: 'knowledge',
  crm_find_contact: 'crm',
  crm_upsert_contact: 'crm',
  crm_log_note: 'crm',
  cal_get_availability: 'cal',
  cal_book_meeting: 'cal',
  track_create_issue: 'track',
  run_flow: 'flow',
  run_robot: 'robots',
  handoff_to_human: 'handoff',
  http_request: 'http',
  mcp_call: 'mcp',
  // Botones y formularios van con la derivación: son parte de la conversación (Chat).
  show_buttons: 'handoff',
  show_form: 'handoff',
  run_code: 'code',
  stripe_customer: 'commerce',
  shopify_order: 'commerce',
  shopify_products: 'commerce',
};

/**
 * Orden de los grupos en la pestaña Herramientas y la app de la suite que
 * toca cada uno. `http`, `mcp`, `code` y `commerce` no están: viven en Avanzado.
 */
export const AGENT_TOOL_GROUP_ORDER = [
  { key: 'knowledge', product: 'docs' },
  { key: 'handoff', product: 'chat' },
  { key: 'crm', product: 'crm' },
  { key: 'cal', product: 'cal' },
  { key: 'track', product: 'track' },
  { key: 'flow', product: 'flow' },
  { key: 'robots', product: 'robots' },
] as const;

/**
 * Herramientas que escriben y pueden pedir la aprobación de alguien del
 * equipo antes de correr (http_request solo cuando no es GET).
 */
export const APPROVABLE_AGENT_TOOLS = [
  'crm_upsert_contact',
  'crm_log_note',
  'cal_book_meeting',
  'track_create_issue',
  'run_flow',
  'http_request',
  'docs_write_page',
  'docs_write_row',
  'mcp_call',
] as const satisfies readonly AgentToolKey[];
export type ApprovableAgentTool = (typeof APPROVABLE_AGENT_TOOLS)[number];

export function isApprovableTool(v: string): v is ApprovableAgentTool {
  return (APPROVABLE_AGENT_TOOLS as readonly string[]).includes(v);
}

/** Herramientas de un grupo, en el orden de AGENT_TOOL_KEYS. */
export function agentToolsInGroup(group: (typeof AGENT_TOOL_GROUP)[AgentToolKey]): AgentToolKey[] {
  return AGENT_TOOL_KEYS.filter((k) => AGENT_TOOL_GROUP[k] === group);
}

/**
 * Handle público sugerido a partir del nombre ("Soporte Acmé" → "soporte-acme"),
 * válido para AGENT_HANDLE_RE. Devuelve null si el nombre no da para uno.
 */
export function suggestAgentHandle(name: string): string | null {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return AGENT_HANDLE_RE.test(slug) ? slug : null;
}

/** Máximo de pasos (llamadas al modelo) por respuesta. */
export const AGENT_MAX_STEPS = 6;
export const AGENT_MAX_URLS = 20;
/** Sitemaps por agente y páginas que se toman de cada uno (lib/agents-knowledge.ts). */
export const AGENT_MAX_SITEMAPS = 3;
export const AGENT_SITEMAP_MAX_PAGES = 300;
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

// ---------- Botones, formularios, procedimientos y código ----------

/** Clave de una variable o de un campo de formulario (email, order_number…). */
export const AGENT_VAR_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const varName = z.string().trim().regex(AGENT_VAR_RE);
const stepId = z.string().trim().regex(/^[a-z0-9_-]{1,40}$/);

export const AGENT_MAX_BUTTONS = 6;
export const AGENT_MAX_FORMS = 5;
export const AGENT_FORM_MAX_FIELDS = 8;
export const AGENT_FORM_FIELD_TYPES = ['text', 'email', 'phone', 'number', 'select', 'textarea'] as const;
export type AgentFormFieldType = (typeof AGENT_FORM_FIELD_TYPES)[number];

const buttonLabel = z.string().trim().min(1).max(80);

export const formFieldSchema = z.object({
  key: varName,
  label: z.string().trim().min(1).max(80),
  type: z.enum(AGENT_FORM_FIELD_TYPES).default('text'),
  required: z.boolean().default(false),
  /** Opciones de un campo select. */
  options: z.array(buttonLabel).max(20).default([]),
});

/**
 * Formulario que el agente muestra dentro del chat (show_form o un paso de un
 * procedimiento). Con `saveToCrm`, lo enviado crea o actualiza el contacto
 * del CRM (campos email, name/first_name/last_name, phone, company).
 */
export const formSchema = z.object({
  id: stepId,
  name: z.string().trim().min(1).max(80),
  title: z.string().trim().max(200).default(''),
  submitLabel: z.string().trim().max(40).default(''),
  fields: z.array(formFieldSchema).min(1).max(AGENT_FORM_MAX_FIELDS),
  saveToCrm: z.boolean().default(false),
});
export type AgentForm = z.infer<typeof formSchema>;
export type AgentFormField = z.infer<typeof formFieldSchema>;

export const AGENT_PROCEDURE_STEP_KINDS = ['message', 'ask', 'form', 'branch', 'action', 'handoff', 'end'] as const;
export type AgentProcedureStepKind = (typeof AGENT_PROCEDURE_STEP_KINDS)[number];
export const AGENT_ANSWER_TYPES = ['text', 'email', 'phone', 'number', 'choice'] as const;
export type AgentAnswerType = (typeof AGENT_ANSWER_TYPES)[number];
export const AGENT_CONDITION_OPS = ['equals', 'not_equals', 'contains', 'exists', 'missing', 'gt', 'lt'] as const;
export type AgentConditionOp = (typeof AGENT_CONDITION_OPS)[number];
/** Herramientas que un paso "Acción" de un procedimiento puede correr (siempre que estén activas). */
export const AGENT_PROCEDURE_TOOLS = [
  'crm_find_contact',
  'crm_upsert_contact',
  'crm_log_note',
  'track_create_issue',
  'run_flow',
  'http_request',
  'run_code',
  'stripe_customer',
  'shopify_order',
] as const satisfies readonly AgentToolKey[];
export type AgentProcedureTool = (typeof AGENT_PROCEDURE_TOOLS)[number];
export const AGENT_MAX_PROCEDURES = 10;
export const AGENT_PROCEDURE_MAX_STEPS = 30;

export const procedureStepSchema = z.object({
  id: stepId,
  kind: z.enum(AGENT_PROCEDURE_STEP_KINDS),
  /** Mensaje, pregunta o motivo de la derivación. Acepta {{variable}}. */
  text: z.string().max(1000).default(''),
  /** ask: dónde se guarda la respuesta. action: dónde se guarda el resultado. */
  field: varName.nullable().default(null),
  answerType: z.enum(AGENT_ANSWER_TYPES).default('text'),
  /** ask: botones de respuesta (con answerType 'choice', la respuesta tiene que ser una de ellas). */
  options: z.array(buttonLabel).max(AGENT_MAX_BUTTONS).default([]),
  /** form: formulario de settings.forms. */
  formId: stepId.nullable().default(null),
  /** branch: si se cumple, salta a `goto`; si no, sigue con el próximo paso. */
  condition: z
    .object({
      field: z.string().trim().min(1).max(80),
      op: z.enum(AGENT_CONDITION_OPS),
      value: z.string().max(200).default(''),
    })
    .nullable()
    .default(null),
  goto: stepId.nullable().default(null),
  /** action: herramienta y argumentos (cada valor acepta {{variable}}). */
  tool: z.enum(AGENT_PROCEDURE_TOOLS).nullable().default(null),
  args: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), z.string().max(2000)).default({}),
});
export type AgentProcedureStep = z.infer<typeof procedureStepSchema>;

/**
 * Procedimiento: pasos que el agente sigue en orden, sin improvisar. Empieza
 * con una palabra clave o cuando el modelo reconoce el caso (`trigger`).
 */
export const procedureSchema = z.object({
  id: stepId,
  name: z.string().trim().min(1).max(80),
  trigger: z.string().trim().max(500).default(''),
  keywords: z.array(z.string().trim().min(2).max(60)).max(10).default([]),
  steps: z.array(procedureStepSchema).min(1).max(AGENT_PROCEDURE_MAX_STEPS),
});
export type AgentProcedure = z.infer<typeof procedureSchema>;

export const AGENT_MAX_CODE_FUNCTIONS = 10;
export const AGENT_CODE_PARAM_TYPES = ['string', 'number', 'boolean'] as const;

/**
 * Función de código propio (JavaScript) que el agente llama con run_code. Corre
 * en una microVM efímera sin red (lib/flow-code.ts), con tope de tiempo y memoria.
 */
export const codeFunctionSchema = z.object({
  id: stepId,
  name: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/),
  description: z.string().trim().max(500).default(''),
  params: z
    .array(
      z.object({
        name: varName,
        type: z.enum(AGENT_CODE_PARAM_TYPES).default('string'),
        description: z.string().trim().max(200).default(''),
      }),
    )
    .max(8)
    .default([]),
  code: z.string().min(1).max(20_000),
  timeoutSec: z.number().int().min(1).max(30).default(10),
});
export type AgentCodeFunction = z.infer<typeof codeFunctionSchema>;

/** Bloque interactivo que acompaña una respuesta (botones o un formulario). */
export type AgentReplyUi =
  | { kind: 'buttons'; options: string[] }
  | {
      kind: 'form';
      formId: string;
      title: string;
      submitLabel: string;
      fields: Array<{ key: string; label: string; type: AgentFormFieldType; required: boolean; options: string[] }>;
      /** Ya se envió (no se acepta ni se muestra de nuevo). */
      consumed?: boolean;
    };

export const AGENT_VOICE_LANGUAGES = ['en-US', 'es-US', 'es-MX', 'es-ES', 'pt-BR'] as const;

export const knowledgeConfigSchema = z.object({
  allPublicDocs: z.boolean().default(true),
  docsPageIds: z.array(id).max(200).default([]),
  urls: z.array(z.string().trim().url().max(2000)).max(AGENT_MAX_URLS).default([]),
  cannedFromWidgetId: id.nullable().default(null),
  /**
   * Sitemaps (o la raíz de un sitio: se prueba /sitemap.xml): cada página que
   * listan, filtrada por `prefix` (un path, opcional), entra como URL de
   * conocimiento con su sitemap como origen.
   */
  sitemaps: z
    .array(
      z.object({
        url: z.string().trim().url().max(2000),
        prefix: z.string().trim().max(300).default(''),
      }),
    )
    .max(AGENT_MAX_SITEMAPS)
    .default([]),
});

export const toolsConfigSchema = z.object({
  enabled: z.array(z.enum(AGENT_TOOL_KEYS)).max(AGENT_TOOL_KEYS.length).default(['search_knowledge', 'handoff_to_human']),
  calEventTypeId: id.nullable().default(null),
  calDays: z.number().int().min(1).max(30).default(7),
  trackProjectId: id.nullable().default(null),
  flowIds: z.array(id).max(20).default([]),
  /** Robots que el agente puede correr (run_robot). */
  robotIds: z.array(id).max(20).default([]),
  /**
   * Páginas de Docs con las que trabaja el agente (docs_*): las lee, edita y
   * crea subpáginas y filas adentro. Incluye sus subpáginas. Vacío = ninguna.
   */
  docsPageIds: z.array(id).max(50).default([]),
  /**
   * Con los permisos de quién trabaja en Docs: la persona que eligió las
   * páginas por última vez (lo pone el servidor al guardar; nunca el dueño
   * del workspace por defecto).
   */
  docsActorId: id.nullable().default(null),
  httpAllowedDomains: z.array(domain).max(20).default([]),
  /** Acciones que esperan la aprobación de alguien del equipo (lib/agents-approvals.ts). */
  requireApproval: z.array(z.enum(APPROVABLE_AGENT_TOOLS)).max(APPROVABLE_AGENT_TOOLS.length).default([]),
  /** Funciones de código propio (run_code). */
  codeFunctions: z.array(codeFunctionSchema).max(AGENT_MAX_CODE_FUNCTIONS).default([]),
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

const AGENT_CHANNEL_RULE_MAX = 4000;
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

/**
 * Ajustes que no son herramientas ni conocimiento: instrucciones por canal,
 * citas, contexto del visitante identificado, memoria, privacidad, bloqueos
 * y el scorecard de calidad. Entra en las versiones como el resto.
 */
export const settingsConfigSchema = z.object({
  /** Instrucciones que se suman a las generales según por dónde llega la conversación. */
  channelInstructions: z
    .object({
      chat: z.string().max(AGENT_CHANNEL_RULE_MAX).default(''),
      public: z.string().max(AGENT_CHANNEL_RULE_MAX).default(''),
      api: z.string().max(AGENT_CHANNEL_RULE_MAX).default(''),
    })
    .default({}),
  /** Cita la fuente (con link si es pública) cuando responde con el conocimiento. */
  citations: z.boolean().default(true),
  /** Lee el CRM, las reservas de Cal y los issues de Track del visitante identificado. */
  visitorContext: z.boolean().default(false),
  /** Recuerda datos del visitante identificado entre conversaciones. */
  memory: z.boolean().default(false),
  /** Tapa emails, teléfonos, tarjetas y documentos en los transcripts guardados. */
  redactPii: z.boolean().default(false),
  /** Países (ISO 3166-1 alfa-2) desde los que la página pública y el widget no responden. */
  blockedCountries: z.array(countryCode).max(250).default([]),
  /** Mensajes con alguna de estas palabras se tratan como spam: el agente no corre. */
  blockedWords: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  /** Puntaje con AI de cada conversación (CSAT, sentimiento, tema, scorecard). Apagado: no gasta AI. */
  aiScoring: z.boolean().default(false),
  /** Criterios del scorecard de calidad (cada conversación se puntúa contra ellos). */
  scorecard: z.array(z.string().trim().min(3).max(200)).max(10).default([]),
  /** Además de los patrones, la AI tapa nombres de personas y direcciones (gasta AI). */
  redactNames: z.boolean().default(false),
  /** Búsqueda semántica: indexa el conocimiento con embeddings (gasta AI al indexar). */
  semanticSearch: z.boolean().default(false),
  /** Contesta los emails que llegan a la dirección de los widgets de Chat que atiende. */
  answerEmails: z.boolean().default(false),
  /** Formularios que el agente puede mostrar en el chat. */
  forms: z.array(formSchema).max(AGENT_MAX_FORMS).default([]),
  /** Procedimientos de varios pasos. */
  procedures: z.array(procedureSchema).max(AGENT_MAX_PROCEDURES).default([]),
  /** Teléfono (Twilio): idioma del reconocimiento de voz, saludo y número al que deriva. */
  voice: z
    .object({
      language: z.enum(AGENT_VOICE_LANGUAGES).default('en-US'),
      greeting: z.string().trim().max(300).default(''),
      handoffNumber: z
        .string()
        .trim()
        .max(20)
        .regex(/^(\+[1-9]\d{7,14})?$/)
        .default(''),
    })
    .default({}),
});

export type AgentSettingsConfig = z.infer<typeof settingsConfigSchema>;
export const AGENT_SETTINGS_CHANNELS = ['chat', 'public', 'api'] as const;

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
  settings: settingsConfigSchema.optional(),
});

export type AgentUpdatePayload = z.infer<typeof agentUpdateSchema>;

export const AGENT_TEMPLATE_KEYS = ['support', 'sdr', 'qualifier'] as const;
export type AgentTemplateKey = (typeof AGENT_TEMPLATE_KEYS)[number];

export const agentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  template: z.enum(AGENT_TEMPLATE_KEYS).optional(),
  instructions: z.string().max(12_000).optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
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
export const parseSettings = (raw: string | null | undefined) => parseWith(settingsConfigSchema, raw);

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
  settings: AgentSettingsConfig;
  enabled: boolean;
  publicHandle: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Canales que muestra la lista de agentes (Flow = conversaciones abiertas por un nodo de Flow). */
export const AGENT_USAGE_CHANNELS = ['chat', 'public', 'api', 'flow'] as const;
export type AgentUsageChannel = (typeof AGENT_USAGE_CHANNELS)[number];

export interface AgentListItem extends AgentDto {
  conversations7d: number;
  /** Conversaciones de los últimos 7 días por canal (sin el playground). */
  usage7d: Record<AgentUsageChannel, number>;
  thumbsUp: number;
  thumbsDown: number;
  channels: AgentUsageChannel[];
}

// ---------- http_request: métodos y headers secretos ----------

export const AGENT_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type AgentHttpMethod = (typeof AGENT_HTTP_METHODS)[number];
export const AGENT_MAX_SECRET_HEADERS = 10;

/** Headers que no se pueden fijar a mano (los maneja fetch o rompen la request). */
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'user-agent',
  'cookie',
  'expect',
  'te',
  'upgrade',
]);

/** Header secreto tal como lo ve la UI: nunca el valor. */
export interface AgentSecretHeaderDto {
  id: string;
  name: string;
  /** Dominio de la lista permitida al que se manda (subdominios incluidos). */
  domain: string;
  createdAt: string;
}

export const secretHeaderInputSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/)
    .refine((n) => !RESERVED_HEADERS.has(n.toLowerCase()), { message: 'reserved_header' }),
  domain,
  // Sin saltos de línea: un valor con CR/LF podría inyectar otros headers.
  value: z.string().min(1).max(4000).regex(/^[^\r\n]+$/),
});

export type AgentSecretHeaderInput = z.infer<typeof secretHeaderInputSchema>;

/**
 * Una salida de herramienta simulada (playground y tests en modo dry run):
 * la herramienta de escritura no se ejecutó y `wouldRun` describe qué habría hecho.
 */
export function isSimulatedOutput(output: unknown): output is { simulated: true; wouldRun: unknown } {
  return Boolean(output && typeof output === 'object' && (output as { simulated?: unknown }).simulated === true);
}

// ---------- Casos de prueba ----------

export const AGENT_MAX_TESTS = 50;

export const AGENT_TEST_KINDS = ['single', 'simulation'] as const;
export type AgentTestKind = (typeof AGENT_TEST_KINDS)[number];
export const AGENT_SIM_MAX_TURNS = 8;

/**
 * single: una pregunta y lo esperado. simulation: un cliente AI (persona)
 * abre con `question` y sigue la charla hasta `maxTurns` turnos; `expected`
 * es el criterio de éxito de toda la conversación.
 */
export const testCaseInputSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  expected: z.string().trim().min(1).max(2000),
  kind: z.enum(AGENT_TEST_KINDS).default('single'),
  persona: z.string().trim().max(1000).default(''),
  maxTurns: z.number().int().min(2).max(AGENT_SIM_MAX_TURNS).default(4),
});

export type AgentTestCaseInput = z.input<typeof testCaseInputSchema>;

export interface AgentTestToolSummary {
  tool: string;
  simulated: boolean;
  error: string | null;
}

export interface AgentTestCaseDto {
  id: string;
  question: string;
  expected: string;
  kind: AgentTestKind;
  persona: string;
  maxTurns: number;
  /** Simulación: la conversación de la última corrida (cliente AI y agente). */
  lastTranscript: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastStatus: 'pass' | 'fail' | 'error' | null;
  lastReason: string;
  lastReply: string;
  lastTools: AgentTestToolSummary[];
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
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

/** Acción que espera la aprobación de alguien del equipo (lib/agents-approvals.ts). */
export interface AgentPendingActionDto {
  id: string;
  conversationId: string;
  tool: ApprovableAgentTool;
  input: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'failed';
  /** Lo que devolvió la acción al aprobarla (o el error). */
  result: unknown;
  decidedBy: string;
  decidedAt: string | null;
  createdAt: string;
  /** Docs: quien mira no puede editar la página destino (no ve el detalle ni decide). */
  locked?: boolean;
}

export interface AgentMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Botones o formulario que acompañaron la respuesta. */
  ui?: AgentReplyUi | null;
  runId: string | null;
  createdAt: string;
  rating?: number | null;
  note?: string;
  /** Lo escribió una persona del equipo (después de derivar), no el agente. */
  teammate?: boolean;
}

export interface AgentConversationDto {
  id: string;
  channel: 'playground' | 'public' | 'api' | 'chat';
  title: string;
  handedOff: boolean;
  /** 'flow' = la abrió un nodo de Flow (channel 'api'). */
  source: 'flow' | null;
  chatConversationId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  /** Puntaje con AI (lib/agents-quality.ts), si ya se puntuó. */
  csat?: number | null;
  sentiment?: AgentSentiment | null;
  /** Marcada como revisada en la cola de calidad. */
  reviewedAt?: string | null;
  /** Visitante identificado (firma del widget o la API). */
  visitorEmail?: string | null;
}

export const AGENT_SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type AgentSentiment = (typeof AGENT_SENTIMENTS)[number];

/** Puntaje de calidad de una conversación (AI). */
export interface AgentConversationScoreDto {
  /** 1 a 5, como una encuesta CSAT. */
  csat: number;
  sentiment: AgentSentiment;
  resolved: boolean;
  topic: string;
  summary: string;
  /** Scorecard del dueño: un resultado por criterio. */
  criteria: Array<{ criterion: string; pass: boolean; note: string }>;
  scoredAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string;
}

/** Eventos del stream NDJSON de una respuesta (playground y página pública). */
export type AgentStreamEvent =
  | { type: 'start'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; id: string; tool: string; input: unknown }
  | { type: 'tool-end'; id: string; tool: string; output: unknown; error: string | null; durationMs: number }
  | { type: 'done'; messageId: string | null; text: string; status: string; handoff: boolean; ui?: AgentReplyUi | null }
  | { type: 'error'; code: string };
