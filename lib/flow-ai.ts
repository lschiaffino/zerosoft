/**
 * Flow — IA: el paso "Extraer / clasificar" (salida estructurada), el
 * diagnóstico de una corrida fallida y armar un flow desde una descripción.
 * Todo pasa por lib/ai.ts (cuota, rate limit, ai_usage). Con FLOW_AI_FAKE=1
 * (e2e, nunca en un deploy de producción) responde un modelo determinista
 * que igual consume la cuota. Server-only.
 */
import { z } from 'zod';
import { aiEnabled, aiGenerateObject, AiError, assertAiQuota } from './ai';
import { StepError } from './flow-errors';
import {
  FLOW_EVENT_TYPES,
  isNoteType,
  isTriggerType,
  NODE_DEFS,
  NODE_TYPES,
  nodeOutputs,
  validateGraph,
  type FieldDef,
  type FlowGraph,
  type FlowNode,
  type FlowNodeType,
} from './flow-schema';

/**
 * Modelo falso de e2e: FLOW_AI_FAKE=1 (nunca en producción) y, dentro de un
 * request, la cookie flow_ai_fake=on (el resto de la suite ve Flow sin IA).
 * Fuera de un request (tests unitarios, worker) alcanza con la variable.
 */
export async function flowAiFake(): Promise<boolean> {
  if (process.env.FLOW_AI_FAKE !== '1' || process.env.VERCEL_ENV === 'production') return false;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get('flow_ai_fake')?.value === 'on';
  } catch {
    return true;
  }
}

async function flowAiObject<T>(opts: {
  ws: string;
  feature: string;
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  fake: () => T;
  maxOutputTokens?: number;
}): Promise<T> {
  if (await flowAiFake()) {
    await assertAiQuota(opts.ws);
    return opts.schema.parse(opts.fake());
  }
  if (!aiEnabled()) throw new AiError('ai_disabled');
  const res = await aiGenerateObject({
    workspaceId: opts.ws,
    feature: opts.feature,
    instructions: opts.instructions,
    prompt: opts.prompt,
    schema: opts.schema,
    maxOutputTokens: opts.maxOutputTokens ?? 1200,
    temperature: 0.1,
  });
  return res.object;
}

// ---------- Paso "Extraer / clasificar" ----------

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const EMAIL_IN_TEXT = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[A-Za-z]{2,}/;

/** Campos a extraer: filas clave/descripción del editor (claves válidas, sin repetir). */
export function extractFields(raw: unknown): Array<{ key: string; description: string }> {
  const rows = Array.isArray(raw) ? (raw as Array<{ key?: unknown; value?: unknown }>) : [];
  const seen = new Set<string>();
  const out: Array<{ key: string; description: string }> = [];
  for (const r of rows.slice(0, 40)) {
    const key = String(r?.key ?? '').trim();
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, description: String(r?.value ?? '').trim().slice(0, 300) });
  }
  return out;
}

export function classifyCategories(raw: unknown): string[] {
  return [...new Set(String(raw ?? '').split('\n').map((c) => c.trim()).filter(Boolean))].slice(0, 50).map((c) => c.slice(0, 100));
}

/** Respuesta del modelo falso (e2e): "clave: valor" en el texto, el email si la clave lo pide. */
export function fakeExtract(text: string, fields: Array<{ key: string }>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const { key } of fields) {
    const line = new RegExp(`(?:^|\\n)\\s*${key.replace(/_/g, '[ _]')}\\s*[:=]\\s*(.+)`, 'i').exec(text);
    if (line) out[key] = line[1].trim();
    else if (/mail/i.test(key)) out[key] = EMAIL_IN_TEXT.exec(text)?.[0] ?? null;
    else out[key] = null;
  }
  return out;
}

export function fakeClassify(text: string, categories: string[]): { category: string; confidence: number; reason: string } {
  const hit = categories.find((c) => text.toLowerCase().includes(c.toLowerCase()));
  return { category: hit ?? categories[0], confidence: hit ? 0.9 : 0.4, reason: hit ? `Mentions "${hit}".` : 'No category is mentioned.' };
}

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * Extrae campos con tipo de un texto, o lo clasifica en una de las
 * categorías. La salida es un objeto (no texto): los pasos siguientes leen
 * {{nodes.<id>.output.<campo>}} o {{nodes.<id>.output.category}}.
 */
export async function aiExtractNode(ws: string, cfg: { mode: string; text: string; fields: unknown; categories: unknown; instructions: string }) {
  const text = cfg.text.trim().slice(0, 20_000);
  if (!text) throw new StepError('missing_text');
  try {
    if (cfg.mode === 'classify') {
      const cats = classifyCategories(cfg.categories);
      if (cats.length < 2) throw new StepError('missing_categories');
      const schema = z.object({
        category: z.enum(cats as [string, ...string[]]),
        confidence: z.number().min(0).max(1),
        reason: z.string().max(500),
      });
      return await flowAiObject({
        ws,
        feature: 'flow',
        instructions: [
          'Classify the text into exactly one of the given categories.',
          'Return the category name exactly as written, a confidence between 0 and 1 and a one-sentence reason.',
          cfg.instructions,
        ]
          .filter(Boolean)
          .join('\n'),
        prompt: `Categories:\n${cats.map((c) => `- ${c}`).join('\n')}\n\nText:\n${text}`,
        schema,
        fake: () => fakeClassify(text, cats),
        maxOutputTokens: 300,
      });
    }
    const fields = extractFields(cfg.fields);
    if (fields.length === 0) throw new StepError('missing_fields');
    const schema = z.object(Object.fromEntries(fields.map((f) => [f.key, scalar])) as Record<string, typeof scalar>);
    return (await flowAiObject({
      ws,
      feature: 'flow',
      instructions: [
        'Extract the requested fields from the text. Use null when a field is not in the text: never invent values.',
        'Keep values short and in the language of the text. Dates as YYYY-MM-DD when possible, numbers as numbers.',
        cfg.instructions,
      ]
        .filter(Boolean)
        .join('\n'),
      prompt: `Fields:\n${fields.map((f) => `- ${f.key}${f.description ? `: ${f.description}` : ''}`).join('\n')}\n\nText:\n${text}`,
      schema,
      fake: () => fakeExtract(text, fields),
      maxOutputTokens: 800,
    })) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof StepError) throw err;
    if (err instanceof AiError) throw new StepError(err.code, err.code === 'rate_limited');
    throw new StepError('ai_error', true);
  }
}

// ---------- Diagnóstico de una corrida fallida ----------

const SENSITIVE_KEY = /token|secret|password|passwd|api[-_]?key|authorization|cookie|signature|private/i;

/** Config de un nodo sin valores que parezcan secretos (headers con tokens pegados a mano). */
export function redactConfig(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => {
      if (v && typeof v === 'object' && 'key' in v && SENSITIVE_KEY.test(String((v as { key: unknown }).key))) {
        return { ...(v as object), value: '[redacted]' };
      }
      return redactConfig(v, depth + 1);
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redactConfig(v, depth + 1)]),
    );
  }
  return typeof value === 'string' ? redactSecretsInText(value.slice(0, 2000)) : value;
}

/** Prefijos de tokens conocidos (Stripe, Slack, GitHub, AWS, Google, JWT, OpenAI/Anthropic). */
const KNOWN_TOKEN = /\b(?:[sprw]k_(?:live|test)_[A-Za-z0-9]{8,}|xox[abeoprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,})/g;
/** Parámetros de URL o asignaciones con nombre de secreto. */
const NAMED_SECRET = /((?:[?&]|\b)(?:token|access_token|api[_-]?key|apikey|key|secret|password|passwd|auth|signature|sig)\s*[=:]\s*["']?)[^&\s"']+/gi;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/**
 * Tapa en un texto (URL, código, cuerpo) lo que parece un secreto: tokens con
 * prefijos conocidos, valores de parámetros con nombre de secreto y cadenas
 * largas de alta entropía con letras y números mezclados.
 */
export function redactSecretsInText(text: string): string {
  return text
    .replace(KNOWN_TOKEN, '[redacted]')
    .replace(NAMED_SECRET, '$1[redacted]')
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) && entropy(m) >= 3.5 ? '[redacted]' : m));
}

export const troubleshootSchema = z.object({
  summary: z.string().max(600),
  cause: z.string().max(800),
  steps: z.array(z.string().max(400)).max(6),
});
export type Troubleshoot = z.infer<typeof troubleshootSchema>;

export interface TroubleshootInput {
  flowName: string;
  error: string;
  triggerType: string;
  failedNode: { id: string; type: string; config: Record<string, unknown> } | null;
  /** Entrada y salida del paso: solo si quien pide puede ver los datos de la corrida. */
  stepData: { input: unknown; output: unknown } | null;
  /** Texto legible del código de error (el mismo que muestra la app). */
  errorText: string;
}

function clip(v: unknown, n: number): string {
  try {
    return JSON.stringify(v ?? null).slice(0, n);
  } catch {
    return '';
  }
}

export async function troubleshootRun(ws: string, input: TroubleshootInput, locale: string): Promise<Troubleshoot> {
  const node = input.failedNode;
  const lang = locale === 'es' ? 'Spanish' : locale === 'pt' ? 'Portuguese' : 'English';
  return flowAiObject({
    ws,
    feature: 'flow',
    instructions: [
      'You help people fix failed automation runs in Flow (a Zapier-like tool).',
      `Answer in ${lang}, in plain words, for someone who is not a developer.`,
      'summary: what happened in one sentence. cause: the most likely reason. steps: up to 5 concrete things to change in the step or the connected service.',
      'Only use what is in the run. If you are not sure, say what to check. Never ask for passwords or tokens.',
    ].join('\n'),
    prompt: [
      `Flow: ${input.flowName}`,
      `Trigger: ${input.triggerType}`,
      `Error code: ${input.error}`,
      input.errorText ? `Error message shown to the user: ${input.errorText}` : '',
      node ? `Failed step: ${node.id} (${node.type})\nStep settings: ${clip(redactConfig(node.config), 4000)}` : 'The run failed before any step.',
      input.stepData
        ? `Step input: ${redactSecretsInText(clip(input.stepData.input, 3000))}\nStep output: ${redactSecretsInText(clip(input.stepData.output, 3000))}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    schema: troubleshootSchema,
    fake: () => ({
      summary: node ? `The step ${node.id} failed with ${input.error}.` : `The run failed with ${input.error}.`,
      cause: input.errorText || input.error,
      steps: ['Open the step in the editor and check its settings.', 'Run "Test step" with sample data.', 'Replay the run once it is fixed.'],
    }),
    maxOutputTokens: 700,
  });
}

// ---------- Armar un flow desde una descripción ----------

/** Nodos que el armador puede usar (todos menos las notas). */
const BUILDABLE = NODE_TYPES.filter((t) => !isNoteType(t));

function catalogLine(type: FlowNodeType): string {
  const fields = (NODE_DEFS[type].fields as readonly FieldDef[])
    .filter((f) => !f.advanced)
    .map((f) => (f.options ? `${f.key}(${f.options.filter(Boolean).join('|')})` : f.key))
    .join(', ');
  const outs = NODE_DEFS[type].outputs.join('|') || 'none';
  return `- ${type} [outputs: ${outs}] fields: ${fields}`;
}

export const builtFlowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  nodes: z
    .array(
      z.object({
        id: z.string().max(40),
        type: z.string(),
        /** Config del nodo como JSON (objeto). */
        configJson: z.string().max(8000),
      }),
    )
    .min(1)
    .max(25),
  edges: z.array(z.object({ source: z.string(), target: z.string(), sourceHandle: z.string().max(40) })).max(60),
});
export type BuiltFlow = z.infer<typeof builtFlowSchema>;

/** Modelo falso (e2e): elige trigger y pasos por palabras clave, en cadena. */
export function fakeBuild(prompt: string): BuiltFlow {
  const p = prompt.toLowerCase();
  const nodes: BuiltFlow['nodes'] = [];
  const trigger: [FlowNodeType, Record<string, unknown>] = /\bform|formulario|formulário/.test(p)
    ? ['trigger.form', { title: 'Form', formFields: [{ label: 'Name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }] }]
    : /\brss|feed/.test(p)
      ? ['trigger.poll', { source: 'rss', url: 'https://example.com/feed.xml', everyMinutes: 15 }]
      : /every day|daily|cada día|todos los días|diariamente|todo dia/.test(p)
        ? ['trigger.schedule', { mode: 'daily', time: '09:00', timezone: 'UTC' }]
        : ['trigger.webhook', { accept: 'post_only', respond: 'immediately' }];
  nodes.push({ id: 'trigger', type: trigger[0], configJson: JSON.stringify(trigger[1]) });
  const add = (id: string, type: FlowNodeType, config: Record<string, unknown>) => nodes.push({ id, type, configJson: JSON.stringify(config) });
  if (/classif|clasific|categor/.test(p)) add('classify', 'ai.extract', { mode: 'classify', text: '{{trigger}}', categories: 'Sales\nSupport' });
  if (/crm|contact|contacto|lead/.test(p)) add('contact', 'app.crm_contact', { email: '{{trigger.fields.email}}' });
  if (/sheet|planilla|hoja/.test(p)) add('sheet', 'app.google_sheets', { operation: 'append', range: 'Sheet1', row: [] });
  if (/slack/.test(p)) add('slack', 'app.slack', { channel: '#general', text: 'New item: {{trigger | json}}' });
  if (nodes.length === 1 || /email|correo|e-mail/.test(p)) add('email', 'action.email', { to: 'me@example.com', subject: 'Flow', body: '{{trigger | json}}' });
  const edges = nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id, sourceHandle: 'out' }));
  return { name: prompt.trim().slice(0, 60) || 'New flow', description: prompt.trim().slice(0, 500), nodes, edges };
}

/**
 * Del objeto del modelo a un grafo válido: ids limpios, configs parseadas
 * (sobre los defaults del nodo), aristas solo entre nodos que existen y por
 * salidas que el nodo tiene, y posiciones en capas desde el trigger. null si
 * no queda un flow válido.
 */
export function builtToGraph(built: BuiltFlow): FlowGraph | null {
  const ids = new Map<string, string>();
  const nodes: FlowNode[] = [];
  for (const n of built.nodes) {
    if (!(BUILDABLE as string[]).includes(n.type)) continue;
    let id = n.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'node';
    while (nodes.some((x) => x.id === id)) id = `${id.slice(0, 36)}_${nodes.length}`;
    let config: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(n.configJson || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
    } catch {
      config = {};
    }
    const type = n.type as FlowNodeType;
    const defaults: Record<string, unknown> = {};
    for (const f of NODE_DEFS[type].fields as readonly FieldDef[]) if (f.default !== undefined) defaults[f.key] = f.default;
    if (type === 'trigger.event' && !(FLOW_EVENT_TYPES as readonly string[]).includes(String(config.event))) delete config.event;
    // Nunca credenciales inventadas: se eligen en el editor.
    for (const k of Object.keys(config)) if (/credentialId$/.test(k)) delete config[k];
    ids.set(n.id, id);
    nodes.push({ id, type, position: { x: 0, y: 0 }, config: { ...defaults, ...config } });
  }
  const triggers = nodes.filter((n) => isTriggerType(n.type));
  if (triggers.length === 0) return null;
  // Un solo trigger: los demás se descartan.
  const keep = nodes.filter((n) => !isTriggerType(n.type) || n === triggers[0]);
  const byId = new Map(keep.map((n) => [n.id, n]));
  const edges: FlowGraph['edges'] = [];
  for (const e of built.edges) {
    const s = byId.get(ids.get(e.source) ?? '');
    const t = byId.get(ids.get(e.target) ?? '');
    if (!s || !t || s === t || isTriggerType(t.type)) continue;
    const outs = nodeOutputs(s);
    const handle = outs.includes(e.sourceHandle) ? e.sourceHandle : outs[0];
    if (!handle) continue;
    if (edges.some((x) => x.source === s.id && x.target === t.id && x.sourceHandle === handle)) continue;
    edges.push({ id: `e_${s.id}_${handle}_${t.id}`.slice(0, 100), source: s.id, target: t.id, sourceHandle: handle });
  }
  // Capas: profundidad desde el trigger (los sueltos, debajo).
  const depth = new Map<string, number>([[triggers[0].id, 0]]);
  for (let pass = 0; pass < keep.length; pass++) {
    for (const e of edges) {
      const d = depth.get(e.source);
      if (d !== undefined && (depth.get(e.target) ?? -1) < d + 1) depth.set(e.target, d + 1);
    }
  }
  const perLayer = new Map<number, number>();
  for (const n of keep) {
    const d = depth.get(n.id) ?? keep.length;
    const i = perLayer.get(d) ?? 0;
    perLayer.set(d, i + 1);
    n.position = { x: i * 300, y: Math.min(d, 30) * 160 };
  }
  const v = validateGraph({ nodes: keep, edges });
  return v.ok ? v.graph : null;
}

/** El modelo devolvió algo que no arma un flow válido. */
export class FlowBuildError extends Error {
  code = 'ai_invalid_flow' as const;
}

export async function buildFlowFromPrompt(ws: string, prompt: string, locale: string): Promise<{ name: string; description: string; graph: FlowGraph }> {
  const text = prompt.trim().slice(0, 2000);
  const lang = locale === 'es' ? 'Spanish' : locale === 'pt' ? 'Portuguese' : 'English';
  const built = await flowAiObject({
    ws,
    feature: 'flow',
    instructions: [
      'You design automations for Flow, a Zapier-like tool. Build the flow the person describes with the nodes below.',
      'Exactly one trigger node. Connect steps with edges in order; sourceHandle is one of the outputs of the source node.',
      'configJson is a JSON object with the fields of the node. Use {{trigger.x}} and {{nodes.<id>.output.x}} to pass data.',
      'Never include credentials, tokens or credentialId values: the person picks them later.',
      `name and description in ${lang}. Keep it to the fewest steps that do the job.`,
      `Events for trigger.event: ${FLOW_EVENT_TYPES.join(', ')}`,
      'Nodes:',
      ...BUILDABLE.map(catalogLine),
    ].join('\n'),
    prompt: text,
    schema: builtFlowSchema,
    fake: () => fakeBuild(text),
    maxOutputTokens: 4000,
  });
  const graph = builtToGraph(built);
  if (!graph) throw new FlowBuildError('ai_invalid_flow');
  return { name: built.name.trim() || text.slice(0, 60), description: built.description.trim(), graph };
}
