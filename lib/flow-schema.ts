/**
 * Flow — catálogo de nodos, eventos y validación del grafo. Sin dependencias
 * de servidor: lo comparten la API, el motor y el editor visual.
 */
import { z } from 'zod';
import { CONDITION_OPS } from './flow-template';

// ---------- Eventos internos (lib/events.ts) ----------

export const FLOW_EVENT_TYPES = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'link.created',
  'link.clicked',
  'contact.created',
  'contact.updated',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'conversation.created',
  'message.received',
  'page.created',
] as const;
export type FlowEventType = (typeof FLOW_EVENT_TYPES)[number];

/** Ejemplo de datos por evento (para el selector de variables sin corridas). */
export const EVENT_SAMPLES: Record<FlowEventType, Record<string, unknown>> = {
  'booking.created': {
    id: 'bk_1',
    status: 'confirmed',
    startsAt: '2026-01-01T15:00:00Z',
    endsAt: '2026-01-01T15:30:00Z',
    timezone: 'UTC',
    invitee: { name: 'Ada Lovelace', email: 'ada@example.com' },
    eventType: { id: 'et_1', slug: 'intro', title: 'Intro call' },
  },
  'booking.rescheduled': { id: 'bk_1', startsAt: '', invitee: { name: '', email: '' }, eventType: { title: '' } },
  'booking.cancelled': { id: 'bk_1', cancelReason: '', invitee: { name: '', email: '' }, eventType: { title: '' } },
  'link.created': { link: { id: 'lnk_1', slug: 'abc', url: 'https://example.com', shortUrl: '' } },
  'link.clicked': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, url: 'https://example.com' },
    click: { country: 'AR', device: 'desktop', at: '' },
    clicks: 100,
  },
  'contact.created': { id: 'c_1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
  'contact.updated': { id: 'c_1', first_name: '', email: '', change: {} },
  'deal.created': { id: 'd_1', name: 'Acme', amount: 1000, currency: 'USD' },
  'deal.updated': { id: 'd_1', name: '', amount: 0, change: {} },
  'deal.stage_changed': { id: 'd_1', name: '', change: { oldStageId: '', newStageId: '' } },
  'deal.won': { id: 'd_1', name: '', amount: 0 },
  'deal.lost': { id: 'd_1', name: '', amount: 0 },
  'issue.created': {
    issue: { id: 'i_1', identifier: 'ENG-1', title: 'Bug', priority: 'medium', status: 'Todo' },
    project: { id: 'p_1', name: 'Engineering' },
  },
  'issue.updated': { issue: { id: 'i_1', identifier: 'ENG-1', title: '', status: '' }, project: { id: '', name: '' } },
  'issue.status_changed': {
    issue: { id: 'i_1', identifier: 'ENG-1', title: '' },
    from: 'Todo',
    to: 'Done',
    project: { id: '', name: '' },
  },
  'conversation.created': { conversation: { id: 'cv_1', subject: '' }, widget: { id: 'w_1', name: 'Site' } },
  'message.received': {
    message: { id: 'm_1', body: 'Hello! I need help with my order.' },
    conversation: { id: 'cv_1' },
    visitor: { id: 'v_1', name: '', email: '' },
    widget: { id: 'w_1', name: 'Site' },
  },
  'page.created': { page: { id: 'pg_1', title: 'Untitled' } },
};

// ---------- Catálogo de nodos ----------

export type NodeCategory = 'trigger' | 'logic' | 'data' | 'action' | 'app' | 'ai';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'bool'
  | 'json'
  | 'kv'
  | 'conditions'
  | 'cases'
  | 'event';

export interface FieldDef {
  key: string;
  kind: FieldKind;
  options?: readonly string[];
  /** Admite {{variables}} (muestra el selector). */
  template?: boolean;
  placeholder?: string;
  default?: unknown;
}

export interface NodeDef {
  type: string;
  category: NodeCategory;
  /** Salidas fijas. switch las calcula (case-N + default). */
  outputs: readonly string[];
  fields: readonly FieldDef[];
}

const CONDITIONS_FIELDS: readonly FieldDef[] = [
  { key: 'combine', kind: 'select', options: ['all', 'any'], default: 'all' },
  { key: 'conditions', kind: 'conditions', default: [] },
];

export const NODE_DEFS = {
  'trigger.event': {
    type: 'trigger.event',
    category: 'trigger',
    outputs: ['out'],
    fields: [
      { key: 'event', kind: 'event', default: 'contact.created' },
      { key: 'filterPath', kind: 'text', placeholder: 'link.slug' },
      { key: 'filterOp', kind: 'select', options: CONDITION_OPS, default: 'equals' },
      { key: 'filterValue', kind: 'text' },
    ],
  },
  'trigger.webhook': { type: 'trigger.webhook', category: 'trigger', outputs: ['out'], fields: [] },
  'trigger.schedule': {
    type: 'trigger.schedule',
    category: 'trigger',
    outputs: ['out'],
    fields: [
      { key: 'mode', kind: 'select', options: ['interval', 'daily'], default: 'daily' },
      { key: 'every', kind: 'number', default: 1 },
      { key: 'unit', kind: 'select', options: ['minutes', 'hours'], default: 'hours' },
      { key: 'time', kind: 'text', placeholder: '09:00', default: '09:00' },
      { key: 'timezone', kind: 'text', placeholder: 'UTC', default: 'UTC' },
    ],
  },
  'trigger.manual': {
    type: 'trigger.manual',
    category: 'trigger',
    outputs: ['out'],
    fields: [{ key: 'sample', kind: 'json', default: '{}' }],
  },
  'logic.if': { type: 'logic.if', category: 'logic', outputs: ['true', 'false'], fields: CONDITIONS_FIELDS },
  'logic.switch': {
    type: 'logic.switch',
    category: 'logic',
    outputs: ['default'],
    fields: [
      { key: 'value', kind: 'text', template: true, placeholder: '{{trigger.status}}' },
      { key: 'cases', kind: 'cases', default: [] },
    ],
  },
  'logic.filter': { type: 'logic.filter', category: 'logic', outputs: ['out'], fields: CONDITIONS_FIELDS },
  'logic.delay': {
    type: 'logic.delay',
    category: 'logic',
    outputs: ['out'],
    fields: [
      { key: 'amount', kind: 'number', default: 5 },
      { key: 'unit', kind: 'select', options: ['seconds', 'minutes', 'hours', 'days'], default: 'minutes' },
    ],
  },
  'logic.loop': {
    type: 'logic.loop',
    category: 'logic',
    outputs: ['item', 'done'],
    fields: [
      { key: 'items', kind: 'text', template: true, placeholder: '{{trigger.items}}' },
      { key: 'max', kind: 'number', default: 50 },
    ],
  },
  'data.set': {
    type: 'data.set',
    category: 'data',
    outputs: ['out'],
    fields: [{ key: 'fields', kind: 'kv', template: true, default: [] }],
  },
  'data.json_parse': {
    type: 'data.json_parse',
    category: 'data',
    outputs: ['out'],
    fields: [{ key: 'text', kind: 'textarea', template: true, placeholder: '{{trigger.body.payload}}' }],
  },
  'action.http': {
    type: 'action.http',
    category: 'action',
    outputs: ['out'],
    fields: [
      { key: 'method', kind: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'POST' },
      { key: 'url', kind: 'text', template: true, placeholder: 'https://api.example.com/hook' },
      { key: 'headers', kind: 'kv', template: true, default: [] },
      { key: 'body', kind: 'textarea', template: true, placeholder: '{"text": {{nodes.ai.output.text | json}}}' },
      { key: 'parseJson', kind: 'bool', default: true },
      { key: 'timeoutMs', kind: 'number', default: 8000 },
      { key: 'retries', kind: 'number', default: 0 },
    ],
  },
  'action.email': {
    type: 'action.email',
    category: 'action',
    outputs: ['out'],
    fields: [
      { key: 'to', kind: 'text', template: true, placeholder: 'me@example.com' },
      { key: 'subject', kind: 'text', template: true },
      { key: 'body', kind: 'textarea', template: true },
    ],
  },
  'app.crm_contact': {
    type: 'app.crm_contact',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'email', kind: 'text', template: true, placeholder: '{{trigger.body.email}}' },
      { key: 'firstName', kind: 'text', template: true },
      { key: 'lastName', kind: 'text', template: true },
      { key: 'phone', kind: 'text', template: true },
      { key: 'source', kind: 'text', template: true, default: 'flow' },
    ],
  },
  'app.crm_deals': {
    type: 'app.crm_deals',
    category: 'app',
    outputs: ['out'],
    fields: [{ key: 'sinceHours', kind: 'number', default: 24 }],
  },
  'app.track_issue': {
    type: 'app.track_issue',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'projectId', kind: 'text', placeholder: 'project id' },
      { key: 'title', kind: 'text', template: true },
      { key: 'description', kind: 'textarea', template: true },
      { key: 'priority', kind: 'select', options: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    ],
  },
  'app.link': {
    type: 'app.link',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'url', kind: 'text', template: true },
      { key: 'slug', kind: 'text', template: true },
      { key: 'title', kind: 'text', template: true },
    ],
  },
  'app.chat_message': {
    type: 'app.chat_message',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'conversationId', kind: 'text', template: true, placeholder: '{{trigger.conversation.id}}' },
      { key: 'body', kind: 'textarea', template: true },
    ],
  },
  'app.docs_page': {
    type: 'app.docs_page',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'title', kind: 'text', template: true },
      { key: 'content', kind: 'textarea', template: true },
    ],
  },
  'ai.text': {
    type: 'ai.text',
    category: 'ai',
    outputs: ['out'],
    fields: [
      { key: 'instructions', kind: 'textarea', template: true },
      { key: 'prompt', kind: 'textarea', template: true },
      { key: 'maxTokens', kind: 'number', default: 500 },
    ],
  },
} as const satisfies Record<string, NodeDef>;

export type FlowNodeType = keyof typeof NODE_DEFS;
export const NODE_TYPES = Object.keys(NODE_DEFS) as FlowNodeType[];

export function isNodeType(v: string): v is FlowNodeType {
  return Object.prototype.hasOwnProperty.call(NODE_DEFS, v);
}

export function nodeDef(type: string): NodeDef | null {
  return isNodeType(type) ? (NODE_DEFS[type] as NodeDef) : null;
}

export function isTriggerType(type: string): boolean {
  return type.startsWith('trigger.');
}

/** Config inicial de un nodo nuevo (defaults del catálogo). */
export function defaultConfig(type: FlowNodeType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of NODE_DEFS[type].fields as readonly FieldDef[]) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

/** Salidas de un nodo concreto (switch: una por caso + default). */
export function nodeOutputs(node: { type: string; config?: Record<string, unknown> }): string[] {
  if (node.type === 'logic.switch') {
    const cases = Array.isArray(node.config?.cases) ? (node.config?.cases as unknown[]) : [];
    return [...cases.map((_, i) => `case-${i}`), 'default'];
  }
  return [...(nodeDef(node.type)?.outputs ?? [])];
}

// ---------- Grafo ----------

const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const flowNodeSchema = z.object({
  id: nodeId,
  type: z.string().refine(isNodeType, { message: 'unknown_node_type' }),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  config: z.record(z.unknown()).default({}),
});

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: nodeId,
  sourceHandle: z.string().max(40).nullish(),
  target: nodeId,
});

export const flowGraphSchema = z.object({
  nodes: z.array(flowNodeSchema).max(100),
  edges: z.array(flowEdgeSchema).max(300),
});

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };

export type GraphErrorCode =
  | 'invalid_graph'
  | 'graph_too_large'
  | 'duplicate_node'
  | 'unknown_node_type'
  | 'no_trigger'
  | 'multiple_triggers'
  | 'trigger_has_input'
  | 'unknown_edge_node'
  | 'invalid_handle'
  | 'self_loop'
  | 'cycle'
  | 'delay_in_loop';

export type GraphValidation =
  | { ok: true; graph: FlowGraph }
  | { ok: false; error: GraphErrorCode; nodeId?: string };

/** Handle efectivo de una arista ('out' si no se indicó). */
export function edgeHandle(e: Pick<FlowEdge, 'sourceHandle'>): string {
  return e.sourceHandle || 'out';
}

/** Nodos alcanzables desde `start` (sin incluirlo), siguiendo las aristas. */
export function reachableFrom(graph: FlowGraph, start: string, handle?: string): Set<string> {
  const seen = new Set<string>();
  const stack = graph.edges
    .filter((e) => e.source === start && (handle === undefined || edgeHandle(e) === handle))
    .map((e) => e.target);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.source === id) stack.push(e.target);
  }
  return seen;
}

/**
 * Valida estructura y semántica: tipos conocidos, ids únicos, exactamente un
 * trigger (sin entradas), aristas a nodos existentes con handles válidos, sin
 * ciclos y sin Delay dentro del cuerpo de un Loop. La config de cada nodo no
 * se exige completa (se guardan borradores); los faltantes fallan al correr.
 */
export function validateGraph(input: unknown): GraphValidation {
  if (input && typeof input === 'object' && JSON.stringify(input).length > 200_000) {
    return { ok: false, error: 'graph_too_large' };
  }
  const parsed = flowGraphSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.message === 'unknown_node_type') return { ok: false, error: 'unknown_node_type' };
    if (issue?.code === 'too_big') return { ok: false, error: 'graph_too_large' };
    return { ok: false, error: 'invalid_graph' };
  }
  const graph = parsed.data as FlowGraph;
  const byId = new Map<string, FlowNode>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) return { ok: false, error: 'duplicate_node', nodeId: n.id };
    byId.set(n.id, n);
  }
  const triggers = graph.nodes.filter((n) => isTriggerType(n.type));
  if (triggers.length === 0) return { ok: false, error: 'no_trigger' };
  if (triggers.length > 1) return { ok: false, error: 'multiple_triggers', nodeId: triggers[1].id };

  const seenEdges = new Set<string>();
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!src || !dst) return { ok: false, error: 'unknown_edge_node' };
    if (e.source === e.target) return { ok: false, error: 'self_loop', nodeId: e.source };
    if (isTriggerType(dst.type)) return { ok: false, error: 'trigger_has_input', nodeId: dst.id };
    if (!nodeOutputs(src).includes(edgeHandle(e))) return { ok: false, error: 'invalid_handle', nodeId: src.id };
    const key = `${e.source}:${edgeHandle(e)}->${e.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
  }

  // Ciclos: DFS con colores.
  const color = new Map<string, 0 | 1 | 2>();
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  let cycleAt: string | null = null;
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        cycleAt = next;
        return true;
      }
      if (c === 0 && visit(next)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const n of graph.nodes) {
    if ((color.get(n.id) ?? 0) === 0 && visit(n.id)) {
      return { ok: false, error: 'cycle', nodeId: cycleAt ?? n.id };
    }
  }

  for (const loop of graph.nodes.filter((n) => n.type === 'logic.loop')) {
    for (const id of reachableFrom(graph, loop.id, 'item')) {
      if (byId.get(id)?.type === 'logic.delay') return { ok: false, error: 'delay_in_loop', nodeId: id };
    }
  }

  return { ok: true, graph };
}

export function triggerNode(graph: FlowGraph): FlowNode | null {
  return graph.nodes.find((n) => isTriggerType(n.type)) ?? null;
}

// ---------- API ----------

export const flowCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  graph: z.unknown().optional(),
  template: z.string().max(60).optional(),
});

export const flowUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  graph: z.unknown().optional(),
  enabled: z.boolean().optional(),
  /** Versión que se editó (bloqueo optimista). */
  version: z.number().int().positive().optional(),
});

export const flowRunSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

// ---------- Plantillas ----------

export interface FlowTemplate {
  key: string;
  graph: FlowGraph;
}

const P = (x: number, y: number) => ({ x, y });

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  {
    key: 'bookingToTrack',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'booking.created' } },
        {
          id: 'issue',
          type: 'app.track_issue',
          position: P(0, 160),
          config: {
            projectId: '',
            title: 'Prepare: {{trigger.eventType.title}} with {{trigger.invitee.name}}',
            description: '{{trigger.invitee.email}} · {{trigger.startsAt}}',
            priority: 'medium',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'issue' }],
    },
  },
  {
    key: 'linkMilestone',
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          position: P(0, 0),
          config: { event: 'link.clicked', filterPath: 'clicks', filterOp: 'equals', filterValue: '100' },
        },
        {
          id: 'email',
          type: 'action.email',
          position: P(0, 160),
          config: {
            to: '',
            subject: '{{trigger.link.slug}} reached 100 clicks',
            body: 'Your link {{trigger.link.url}} was just clicked for the 100th time.',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'email' }],
    },
  },
  {
    key: 'webhookToContact',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.webhook', position: P(0, 0), config: {} },
        {
          id: 'has_email',
          type: 'logic.filter',
          position: P(0, 160),
          config: { combine: 'all', conditions: [{ left: '{{trigger.body.email}}', op: 'exists', right: '' }] },
        },
        {
          id: 'contact',
          type: 'app.crm_contact',
          position: P(0, 320),
          config: {
            email: '{{trigger.body.email}}',
            firstName: '{{trigger.body.first_name}}',
            lastName: '{{trigger.body.last_name}}',
            source: 'webhook',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'has_email' },
        { id: 'e2', source: 'has_email', target: 'contact' },
      ],
    },
  },
  {
    key: 'dealsDigest',
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.schedule',
          position: P(0, 0),
          config: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 1, unit: 'hours' },
        },
        { id: 'deals', type: 'app.crm_deals', position: P(0, 160), config: { sinceHours: 24 } },
        {
          id: 'any',
          type: 'logic.filter',
          position: P(0, 320),
          config: { combine: 'all', conditions: [{ left: '{{nodes.deals.output.count}}', op: 'gt', right: '0' }] },
        },
        {
          id: 'email',
          type: 'action.email',
          position: P(0, 480),
          config: {
            to: '',
            subject: '{{nodes.deals.output.count}} new deals today',
            body: '{{nodes.deals.output.deals | map:name | lines}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'deals' },
        { id: 'e2', source: 'deals', target: 'any' },
        { id: 'e3', source: 'any', target: 'email' },
      ],
    },
  },
  {
    key: 'chatSummaryToSlack',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'message.received' } },
        {
          id: 'ai',
          type: 'ai.text',
          position: P(0, 160),
          config: {
            instructions: 'Summarize the customer message in one sentence for the support team.',
            prompt: '{{trigger.message.body}}',
            maxTokens: 200,
          },
        },
        {
          id: 'slack',
          type: 'action.http',
          position: P(0, 320),
          config: {
            method: 'POST',
            url: '',
            headers: [{ key: 'content-type', value: 'application/json' }],
            body: '{"text": {{nodes.ai.output.text | json}}}',
            parseJson: false,
            timeoutMs: 8000,
            retries: 2,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'ai' },
        { id: 'e2', source: 'ai', target: 'slack' },
      ],
    },
  },
];
