/**
 * Flow — catálogo de nodos, eventos y validación del grafo. Sin dependencias
 * de servidor: lo comparten la API, el motor y el editor visual.
 */
import { z } from 'zod';
import { CONDITION_OPS } from './flow-template';
import { isValidCron, isValidTimezone } from './cron';

// ---------- Eventos internos (lib/events.ts) ----------

export const FLOW_EVENT_TYPES = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.no_show',
  'booking.requested',
  'booking.declined',
  'booking.refunded',
  'booking.reconfirmed',
  'link.created',
  'link.clicked',
  'link.updated',
  'link.deleted',
  'link.lead',
  'link.sale',
  'contact.created',
  'contact.updated',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'quote.accepted',
  'email.received',
  'email.sent',
  'email.opened',
  'email.clicked',
  'form.submitted',
  'contact.score_changed',
  'issue.created',
  'issue.updated',
  'issue.status_changed',
  'conversation.created',
  'message.received',
  'conversation.assigned',
  'conversation.resolved',
  'conversation.rated',
  'page.created',
  'page.updated',
  'page.archived',
  'page.comment_created',
  'database.row_created',
  'database.property_changed',
  'robot.run.finished',
  'robot.run.failed',
  'robot.output.changed',
  'note.created',
  'note.tagged',
  'note.trashed',
  'board.created',
  'board.deleted',
  'board.comment_created',
  'agent.conversation_started',
  'agent.handoff',
  'agent.feedback',
  'task.created',
  'task.completed',
  'task.due',
  'groups.message.received',
  'groups.ticket.created',
  'groups.ticket.updated',
  'groups.message.sent',
  'groups.chat.created',
  'groups.chat.assigned',
  'groups.chat.closed',
  'groups.member.joined',
  'groups.member.left',
  'groups.poll.voted',
  'talk.message.posted',
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
  'booking.no_show': { id: 'bk_1', status: 'no_show', startsAt: '', invitee: { name: '', email: '' }, eventType: { title: '' } },
  'booking.requested': { id: 'bk_1', status: 'pending', approval: 'pending', startsAt: '', invitee: { name: '', email: '' }, eventType: { title: '' } },
  'booking.declined': {
    id: 'bk_1',
    status: 'cancelled',
    approval: 'declined',
    expired: false,
    startsAt: '',
    invitee: { name: '', email: '' },
    eventType: { title: '' },
  },
  'booking.reconfirmed': { id: 'bk_1', status: 'confirmed', reconfirmedAt: '', startsAt: '', invitee: { name: '', email: '' }, eventType: { title: '' } },
  'booking.refunded': {
    id: 'bk_1',
    status: 'cancelled',
    startsAt: '',
    invitee: { name: '', email: '' },
    payment: { status: 'refunded', amountCents: 5000, currency: 'USD' },
    eventType: { title: '' },
  },
  // Mismo shape que el evento real (toLinkDto en lib/links.ts).
  'link.created': {
    link: {
      id: 'lnk_1',
      slug: 'abc',
      domain: null,
      short_url: 'https://zerosoft.ai/abc',
      url: 'https://example.com',
      title: '',
      tags: [],
      clicks: 0,
      created_at: '',
    },
  },
  'link.clicked': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, url: 'https://example.com', short_url: 'https://zerosoft.ai/abc' },
    click: { country: 'AR', city: 'Córdoba', region: 'X', device: 'desktop', referrerUrl: null, at: '' },
    clicks: 100,
  },
  'link.updated': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, short_url: 'https://zerosoft.ai/abc', url: 'https://example.com', title: '', tags: [] },
    changes: ['url'],
  },
  'link.deleted': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, short_url: 'https://zerosoft.ai/abc', url: 'https://example.com', title: '', tags: [] },
  },
  'link.lead': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, short_url: 'https://zerosoft.ai/abc', url: 'https://example.com', tags: [] },
    lead: { id: 1, eventName: 'Sign up', clickId: 'AbCdEfGhIjKlMnOpQrSt', customer: { externalId: 'user_123' }, at: '' },
  },
  'link.sale': {
    link: { id: 'lnk_1', slug: 'abc', domain: null, short_url: 'https://zerosoft.ai/abc', url: 'https://example.com', tags: [] },
    sale: { id: 2, eventName: 'Purchase', amount: 4900, currency: 'USD', invoiceId: 'inv_1', source: 'api', clickId: null, customer: { externalId: 'user_123' }, at: '' },
  },
  'contact.created': { id: 'c_1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
  'contact.updated': { id: 'c_1', first_name: '', email: '', change: {} },
  'deal.created': { id: 'd_1', name: 'Acme', amount: 1000, currency: 'USD' },
  'deal.updated': { id: 'd_1', name: '', amount: 0, change: {} },
  'deal.stage_changed': { id: 'd_1', name: '', change: { oldStageId: '', newStageId: '' } },
  'deal.won': { id: 'd_1', name: '', amount: 0 },
  'deal.lost': { id: 'd_1', name: '', amount: 0 },
  'quote.accepted': {
    id: 'q_1',
    number: 'Q-2026-0001',
    title: 'Acme — annual plan',
    total: 1210,
    currency: 'USD',
    dealId: 'd_1',
    dealName: 'Acme',
    signerName: 'Ada Lovelace',
  },
  'email.received': {
    email: { id: 'em_1', subject: 'Re: Proposal', from: 'ada@example.com', threadId: 't_1' },
    contactIds: ['c_1'],
  },
  'email.sent': {
    email: { id: 'em_1', subject: 'Proposal', to: 'ada@example.com', threadId: 't_1', via: 'gmail' },
    contactId: 'c_1',
    sequence: null,
  },
  'email.opened': {
    email: { id: 'em_1', subject: 'Proposal', to: 'ada@example.com', threadId: 't_1' },
    contactId: 'c_1',
    openCount: 1,
    clickCount: 0,
  },
  'email.clicked': {
    email: { id: 'em_1', subject: 'Proposal', to: 'ada@example.com', threadId: 't_1' },
    contactId: 'c_1',
    openCount: 1,
    clickCount: 1,
    url: 'https://example.com/pricing',
  },
  'form.submitted': {
    form: { id: 'f_1', name: 'Contact us' },
    submission: { id: 'fs_1', values: { email: 'ada@example.com', first_name: 'Ada' } },
    contact: { id: 'c_1', email: 'ada@example.com', created: true },
    utm: { utm_source: 'google', utm_campaign: 'spring' },
  },
  'contact.score_changed': {
    id: 'c_1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    oldScore: 10,
    newScore: 45,
    breakdown: [{ ruleId: 'r_1', name: 'Opened 3+ emails', points: 15, detail: '3 / 30d' }],
  },
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
    visitor: { id: 'v_1', name: '', email: '', emailVerified: false },
    widget: { id: 'w_1', name: 'Site' },
  },
  'conversation.assigned': {
    conversation: { id: 'cv_1', status: 'open', priority: 'medium', subject: '', assignedTo: 'u_1' },
    assignee: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    widget: { id: 'w_1', name: 'Site' },
  },
  'conversation.resolved': {
    conversation: { id: 'cv_1', status: 'resolved', priority: 'medium', subject: '', assignedTo: null },
    widget: { id: 'w_1', name: 'Site' },
  },
  'conversation.rated': {
    conversation: { id: 'cv_1', status: 'resolved', subject: '' },
    rating: { score: 5, comment: 'Quick and helpful.' },
    widget: { id: 'w_1', name: 'Site' },
  },
  'page.created': { page: { id: 'pg_1', title: 'Untitled' } },
  'page.updated': {
    page: { id: 'pg_1', title: 'Weekly sync', parentId: null, url: '/app/docs/pg_1', updatedAt: '' },
    editedBy: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    text: 'Agenda. Decisions. Next steps.',
  },
  'page.archived': {
    page: { id: 'pg_1', title: 'Old notes', parentId: null, url: '/app/docs/pg_1', updatedAt: '' },
    editedBy: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  'page.comment_created': {
    page: { id: 'pg_1', title: 'Roadmap', parentId: null, url: '/app/docs/pg_1', updatedAt: '' },
    comment: { id: 'cm_1', text: 'Can we ship this in May?', blockId: null, parentId: null },
    author: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  'database.row_created': {
    page: { id: 'pg_1', title: 'Projects', parentId: null, url: '/app/docs/pg_1', updatedAt: '' },
    database: { blockId: 'b_1', title: 'Projects' },
    row: { id: 'r_1', title: 'Website refresh', url: '/app/docs/pg_1?row=r_1', properties: { Status: 'Not started', Owner: 'Ada Lovelace' } },
    editedBy: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  'database.property_changed': {
    page: { id: 'pg_1', title: 'Projects', parentId: null, url: '/app/docs/pg_1', updatedAt: '' },
    database: { blockId: 'b_1', title: 'Projects' },
    row: { id: 'r_1', title: 'Website refresh', url: '/app/docs/pg_1?row=r_1', properties: { Status: 'Done', Owner: 'Ada Lovelace' } },
    property: { id: 'status', name: 'Status', type: 'status' },
    value: 'Done',
    previous: 'In progress',
    editedBy: { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
  'robot.run.finished': {
    robot: { id: 'rb_1', name: 'Price check' },
    run: { id: 'rr_1', status: 'success', trigger: 'schedule', durationMs: 4200, error: null, warnings: 0 },
    output: { title: 'A Light in the Attic', price: '£51.77' },
  },
  'robot.run.failed': {
    robot: { id: 'rb_1', name: 'Price check' },
    run: { id: 'rr_1', status: 'failed', trigger: 'schedule', durationMs: 4200, error: '2: action_timeout' },
    output: {},
  },
  'robot.output.changed': {
    robot: { id: 'rb_1', name: 'Price check' },
    run: { id: 'rr_2', status: 'success', trigger: 'schedule', durationMs: 4100, warnings: 0 },
    previousRunId: 'rr_1',
    diff: [{ key: 'price', kind: 'changed', before: '£51.77', after: '£48.10' }],
    output: { title: 'A Light in the Attic', price: '£48.10' },
  },
  // Notas: título y etiquetas, nunca el contenido (las notas son de cada persona).
  'note.created': {
    note: { id: 'nt_1', title: 'Meeting notes', tags: ['clients'], notebookId: null, sourceUrl: null, createdAt: '' },
    personId: 'u_1',
  },
  'note.tagged': {
    note: { id: 'nt_1', title: 'Meeting notes', tags: ['clients', 'todo'], notebookId: null, sourceUrl: null, createdAt: '' },
    added: ['todo'],
    personId: 'u_1',
  },
  'note.trashed': { note: { id: 'nt_1', title: 'Meeting notes', tags: [], notebookId: null, sourceUrl: null, createdAt: '' }, personId: 'u_1' },
  'board.created': { board: { id: 'bd_1', name: 'Roadmap sketch' }, createdBy: 'u_1' },
  'board.deleted': { board: { id: 'bd_1', name: 'Roadmap sketch' } },
  'board.comment_created': {
    board: { id: 'bd_1', name: 'Roadmap sketch' },
    thread: { id: 'th_1' },
    comment: { id: 'bc_1', body: 'Can we move this box?', authorId: 'u_1' },
  },
  'agent.conversation_started': {
    agent: { id: 'ag_1', name: 'Support agent' },
    conversation: { id: 'ac_1', channel: 'public', chatConversationId: null, title: '' },
  },
  'agent.handoff': {
    agent: { id: 'ag_1', name: 'Support agent' },
    conversation: { id: 'ac_1', channel: 'chat', chatConversationId: 'cv_1', title: '' },
    reason: 'The visitor asked for a person.',
  },
  'agent.feedback': {
    agent: { id: 'ag_1', name: 'Support agent' },
    conversation: { id: 'ac_1', channel: 'public', chatConversationId: null, title: '' },
    messageId: 'am_1',
    rating: -1,
    note: 'Wrong price.',
  },
  'task.created': {
    task: { id: 't_1', subject: 'Follow up with Ada', body: '', dueAt: '2026-01-02T15:00:00Z', done: false, doneAt: null, ownerId: null, contactId: 'c_1', companyId: null, dealId: null },
  },
  'task.completed': {
    task: { id: 't_1', subject: 'Follow up with Ada', body: '', dueAt: '', done: true, doneAt: '', ownerId: null, contactId: 'c_1', companyId: null, dealId: null },
  },
  'task.due': {
    task: { id: 't_1', subject: 'Follow up with Ada', body: '', dueAt: '', done: false, doneAt: null, ownerId: null, contactId: 'c_1', companyId: null, dealId: null },
  },
  'groups.message.received': {
    message: { id: 'gm_1', body: 'Hi team, the invoice did not arrive', senderPhone: '5491155550000', senderName: 'Ada', createdAt: '2026-01-01T15:00:00Z' },
    chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null },
  },
  'groups.ticket.created': {
    ticket: { id: 'gt_1', number: 12, title: 'Invoice did not arrive', status: 'open', priority: 'medium', assigneeId: null, source: 'reaction', dueAt: '2026-01-02T15:00:00Z', messageBody: 'Hi team, the invoice did not arrive' },
    chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null },
  },
  'groups.ticket.updated': {
    ticket: { id: 'gt_1', number: 12, title: 'Invoice did not arrive', status: 'resolved', priority: 'medium', assigneeId: 'u_1', source: 'reaction', dueAt: '2026-01-02T15:00:00Z', messageBody: '' },
  },
  'groups.message.sent': {
    message: { id: 'gm_2', body: 'Resending it now', authorId: 'u_1', authorKind: 'person', status: 'sent', createdAt: '2026-01-01T15:05:00Z' },
    chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null },
  },
  'groups.chat.created': { chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null } },
  'groups.chat.assigned': { assignedTo: 'u_1', previous: null, chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null } },
  'groups.chat.closed': { closedBy: 'u_1', chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null } },
  'groups.member.joined': { phones: ['5491155550000'], chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null } },
  'groups.member.left': { phones: ['5491155550000'], chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null } },
  'groups.poll.voted': {
    poll: { messageId: 'gm_3', question: 'Which day works?', options: ['Monday', 'Tuesday'] },
    vote: { voter: '5491155550000', voterName: 'Ada', options: ['Tuesday'] },
    results: [{ option: 'Monday', votes: 0 }, { option: 'Tuesday', votes: 1 }],
    chat: { id: 'gc_1', kind: 'group', name: 'Acme support', crmCompanyId: null, crmContactId: null },
  },
  'talk.message.posted': {
    id: 'tm_1',
    channel: { id: 'tc_1', name: 'general', kind: 'public' },
    text: 'Deploy done, please check staging',
    body: 'Deploy done, please check staging',
    userId: 'u_1',
    botName: null,
    threadId: null,
    createdAt: '2026-01-01T15:00:00Z',
  },
};

// ---------- Catálogo de nodos ----------

export type NodeCategory = 'trigger' | 'logic' | 'data' | 'action' | 'app' | 'integration' | 'ai';

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
  | 'event'
  /** Credencial del workspace (options = tipos permitidos). */
  | 'credential'
  /** Otro flow del workspace. */
  | 'flowRef'
  /** Un agente del workspace. */
  | 'agentRef'
  /** Un robot del workspace (elegirlo carga sus entradas en el campo inputs). */
  | 'robotRef'
  /** Expresión cron con vista previa. */
  | 'cron'
  /** Una tabla de datos del workspace (lib/flow-tables.ts). */
  | 'tableRef'
  /** Un chat o grupo de Groups: buscador por nombre, o una variable ({{trigger.chat.id}}). */
  | 'groupsChatRef'
  /** Una página de Docs: buscador por título, o una variable ({{trigger.page.id}}). */
  | 'docsPageRef'
  /** Una base de Docs ("página/bloque"). */
  | 'docsDatabaseRef'
  /** Una plantilla de Docs (del workspace o integrada: builtin:<key>). */
  | 'docsTemplateRef';

export interface FieldDef {
  key: string;
  kind: FieldKind;
  options?: readonly string[];
  /** Admite {{variables}} (muestra el selector). */
  template?: boolean;
  placeholder?: string;
  default?: unknown;
  /** Se muestra solo si otro campo tiene uno de estos valores. */
  showIf?: { key: string; values: readonly string[] };
  /** Opción fina (reintentos, timeouts…): el editor la agrupa en "Avanzado". */
  advanced?: boolean;
}

export interface NodeDef {
  type: string;
  category: NodeCategory;
  /** Salidas fijas. switch las calcula (case-N + default). */
  outputs: readonly string[];
  fields: readonly FieldDef[];
}

/** Modos del nodo Esperar. */
export const DELAY_MODES = ['duration', 'until', 'resume'] as const;
/** Operaciones del nodo Docs: página. */
export const DOCS_PAGE_OPERATIONS = ['page_create', 'page_append', 'page_replace', 'page_rename', 'page_archive'] as const;
/** Operaciones del nodo Docs: fila de una base. */
export const DOCS_ROW_OPERATIONS = ['row_create', 'row_update'] as const;
/** Operaciones del nodo Tabla de datos. */
export const TABLE_OPERATIONS = ['find', 'insert', 'upsert', 'delete'] as const;

/** Métodos que acepta un trigger.webhook. */
export const WEBHOOK_ACCEPT = ['post_only', 'get_only', 'get_post'] as const;
/** Cuándo responde: al instante (202) o con lo que arme el nodo "Responder al webhook". */
export const WEBHOOK_RESPOND = ['immediately', 'reply_node'] as const;

/** Campos de CRM que puede escribir "CRM: actualizar registro" (claves de ContactInput, CompanyInput, DealInput). */
export const CRM_UPDATE_FIELDS = {
  contact: ['firstName', 'lastName', 'email', 'phone', 'jobTitle', 'website', 'city', 'country', 'lifecycleStage', 'leadStatus', 'source', 'ownerId', 'companyId'],
  company: ['name', 'domain', 'industry', 'employees', 'phone', 'website', 'city', 'country', 'lifecycleStage', 'ownerId'],
  deal: ['name', 'amount', 'currency', 'closeDate', 'priority', 'source', 'description', 'lostReason', 'ownerId', 'companyId'],
} as const;
export type CrmUpdateEntity = keyof typeof CRM_UPDATE_FIELDS;

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
      { key: 'filterPath', kind: 'text', placeholder: 'link.slug', advanced: true },
      { key: 'filterOp', kind: 'select', options: CONDITION_OPS, default: 'equals', advanced: true },
      { key: 'filterValue', kind: 'text', advanced: true },
    ],
  },
  'trigger.webhook': {
    type: 'trigger.webhook',
    category: 'trigger',
    outputs: ['out'],
    fields: [
      { key: 'accept', kind: 'select', options: WEBHOOK_ACCEPT, default: 'post_only' },
      /** Opcional: header (api_key) o usuario y contraseña (basic) que exige la URL. */
      { key: 'authCredentialId', kind: 'credential', options: ['api_key', 'basic'] },
      { key: 'respond', kind: 'select', options: WEBHOOK_RESPOND, default: 'immediately' },
    ],
  },
  'trigger.schedule': {
    type: 'trigger.schedule',
    category: 'trigger',
    outputs: ['out'],
    fields: [
      { key: 'mode', kind: 'select', options: ['interval', 'daily', 'cron'], default: 'daily' },
      { key: 'every', kind: 'number', default: 1, showIf: { key: 'mode', values: ['interval'] } },
      { key: 'unit', kind: 'select', options: ['minutes', 'hours'], default: 'hours', showIf: { key: 'mode', values: ['interval'] } },
      { key: 'time', kind: 'text', placeholder: '09:00', default: '09:00', showIf: { key: 'mode', values: ['daily'] } },
      { key: 'cron', kind: 'cron', placeholder: '0 9 * * 1-5', default: '0 9 * * 1-5', showIf: { key: 'mode', values: ['cron'] } },
      { key: 'timezone', kind: 'text', placeholder: 'UTC', default: 'UTC', showIf: { key: 'mode', values: ['daily', 'cron'] } },
    ],
  },
  'trigger.stripe': {
    type: 'trigger.stripe',
    category: 'trigger',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['stripe'] },
      { key: 'events', kind: 'text', placeholder: 'checkout.session.completed, invoice.*', default: '' },
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
      /** duration: un tiempo fijo. until: hasta una fecha. resume: hasta una llamada a {{run.resumeUrl}}. */
      { key: 'mode', kind: 'select', options: DELAY_MODES, default: 'duration' },
      { key: 'amount', kind: 'number', default: 5, showIf: { key: 'mode', values: ['duration'] } },
      {
        key: 'unit',
        kind: 'select',
        options: ['seconds', 'minutes', 'hours', 'days'],
        default: 'minutes',
        showIf: { key: 'mode', values: ['duration'] },
      },
      { key: 'until', kind: 'text', template: true, placeholder: '{{trigger.startsAt}}', showIf: { key: 'mode', values: ['until'] } },
      { key: 'timezone', kind: 'text', placeholder: 'UTC', default: 'UTC', showIf: { key: 'mode', values: ['until'] }, advanced: true },
      { key: 'timeoutAmount', kind: 'number', default: 7, showIf: { key: 'mode', values: ['resume'] } },
      { key: 'timeoutUnit', kind: 'select', options: ['minutes', 'hours', 'days'], default: 'days', showIf: { key: 'mode', values: ['resume'] } },
      { key: 'onTimeout', kind: 'select', options: ['continue', 'fail'], default: 'continue', showIf: { key: 'mode', values: ['resume'] } },
    ],
  },
  'logic.approval': {
    type: 'logic.approval',
    category: 'logic',
    outputs: ['approved', 'rejected'],
    fields: [
      /** Emails separados por coma (hasta 10). */
      { key: 'to', kind: 'text', template: true, placeholder: 'ops@example.com' },
      { key: 'subject', kind: 'text', template: true, placeholder: 'Approve refund for {{trigger.email}}' },
      { key: 'message', kind: 'textarea', template: true },
      /** Opcional: también pide la aprobación en Slack (botones que abren la página). */
      { key: 'slackCredentialId', kind: 'credential', options: ['slack'] },
      { key: 'slackChannel', kind: 'text', template: true, placeholder: '#approvals' },
      { key: 'timeoutAmount', kind: 'number', default: 3, advanced: true },
      { key: 'timeoutUnit', kind: 'select', options: ['hours', 'days'], default: 'days', advanced: true },
      { key: 'onTimeout', kind: 'select', options: ['reject', 'approve', 'fail'], default: 'reject', advanced: true },
    ],
  },
  'logic.loop': {
    type: 'logic.loop',
    category: 'logic',
    outputs: ['item', 'done'],
    fields: [
      { key: 'items', kind: 'text', template: true, placeholder: '{{trigger.items}}' },
      { key: 'max', kind: 'number', default: 50, advanced: true },
    ],
  },
  'data.set': {
    type: 'data.set',
    category: 'data',
    outputs: ['out'],
    fields: [{ key: 'fields', kind: 'kv', template: true, default: [] }],
  },
  'data.table': {
    type: 'data.table',
    category: 'data',
    outputs: ['out'],
    fields: [
      { key: 'tableId', kind: 'tableRef' },
      { key: 'operation', kind: 'select', options: TABLE_OPERATIONS, default: 'find' },
      /** Columna a comparar (find sin columna = las filas más viejas primero). */
      { key: 'column', kind: 'text', placeholder: 'email', showIf: { key: 'operation', values: ['find', 'upsert', 'delete'] } },
      {
        key: 'value',
        kind: 'text',
        template: true,
        placeholder: '{{trigger.email}}',
        showIf: { key: 'operation', values: ['find', 'upsert', 'delete'] },
      },
      { key: 'values', kind: 'kv', template: true, default: [], showIf: { key: 'operation', values: ['insert', 'upsert'] } },
      { key: 'limit', kind: 'number', default: 1, showIf: { key: 'operation', values: ['find'] }, advanced: true },
    ],
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
      { key: 'credentialId', kind: 'credential', options: ['api_key', 'basic', 'oauth_token'] },
      { key: 'headers', kind: 'kv', template: true, default: [], advanced: true },
      { key: 'body', kind: 'textarea', template: true, placeholder: '{"text": {{nodes.ai.output.text | json}}}' },
      { key: 'parseJson', kind: 'bool', default: true, advanced: true },
      { key: 'timeoutMs', kind: 'number', default: 8000, advanced: true },
      { key: 'retries', kind: 'number', default: 0, advanced: true },
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
  'action.webhook_reply': {
    type: 'action.webhook_reply',
    category: 'action',
    outputs: ['out'],
    fields: [
      { key: 'statusCode', kind: 'number', default: 200 },
      { key: 'contentType', kind: 'select', options: ['json', 'text', 'html'], default: 'json' },
      { key: 'body', kind: 'textarea', template: true, placeholder: '{"ok": true, "id": {{nodes.contact.output.contact.id | json}}}' },
      { key: 'headers', kind: 'kv', template: true, default: [], advanced: true },
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
      { key: 'source', kind: 'text', template: true, default: 'flow', advanced: true },
    ],
  },
  'app.crm_sequence': {
    type: 'app.crm_sequence',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'sequenceId', kind: 'text', placeholder: 'sequence id' },
      { key: 'email', kind: 'text', template: true, placeholder: '{{trigger.email}}' },
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
  'app.track_update': {
    type: 'app.track_update',
    category: 'app',
    outputs: ['out'],
    fields: [
      /** Id o identificador (ENG-12). */
      { key: 'issue', kind: 'text', template: true, placeholder: '{{trigger.issue.identifier}}' },
      /** Nombre o id de un status del proyecto ('' = sin cambio). */
      { key: 'status', kind: 'text', template: true, placeholder: 'Done' },
      { key: 'priority', kind: 'select', options: ['keep', 'low', 'medium', 'high', 'urgent'], default: 'keep' },
      /** Email o id de un miembro; 'none' lo desasigna. */
      { key: 'assignee', kind: 'text', template: true, placeholder: 'ada@example.com' },
      { key: 'comment', kind: 'textarea', template: true },
      { key: 'title', kind: 'text', template: true, advanced: true },
      { key: 'dueDate', kind: 'text', template: true, placeholder: '{{now | add_time:7,days | date:date}}', advanced: true },
    ],
  },
  'app.crm_update': {
    type: 'app.crm_update',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'entity', kind: 'select', options: ['contact', 'company', 'deal'], default: 'contact' },
      { key: 'recordId', kind: 'text', template: true, placeholder: '{{trigger.id}}' },
      /** Contactos: si no hay id, se busca por email. */
      { key: 'email', kind: 'text', template: true, placeholder: '{{trigger.email}}', showIf: { key: 'entity', values: ['contact'] } },
      /** Propiedad → valor (firstName, amount, custom.plan…). */
      { key: 'fields', kind: 'kv', template: true, default: [] },
      /** Deals: nombre o id de una etapa del pipeline del deal. */
      { key: 'stage', kind: 'text', template: true, placeholder: 'Won', showIf: { key: 'entity', values: ['deal'] } },
    ],
  },
  'app.crm_task': {
    type: 'app.crm_task',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'subject', kind: 'text', template: true, placeholder: 'Follow up with {{trigger.first_name}}' },
      { key: 'body', kind: 'textarea', template: true },
      { key: 'dueIn', kind: 'number', default: 1 },
      { key: 'dueUnit', kind: 'select', options: ['hours', 'days'], default: 'days' },
      /** Id o email de un contacto. */
      { key: 'contactId', kind: 'text', template: true, placeholder: '{{nodes.contact.output.contact.id}}' },
      { key: 'dealId', kind: 'text', template: true, placeholder: '{{trigger.id}}' },
      { key: 'companyId', kind: 'text', template: true, advanced: true },
      /** Email o id de una persona del workspace (vacío = sin owner). */
      { key: 'owner', kind: 'text', template: true, placeholder: 'ada@example.com', advanced: true },
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
  'app.groups_message': {
    type: 'app.groups_message',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'chatId', kind: 'groupsChatRef', template: true, placeholder: '{{trigger.chat.id}}' },
      { key: 'body', kind: 'textarea', template: true },
    ],
  },
  'app.talk_message': {
    type: 'app.talk_message',
    category: 'app',
    outputs: ['out'],
    fields: [
      /** Nombre del canal (general o #general) o su id. */
      { key: 'channel', kind: 'text', template: true, placeholder: 'general' },
      { key: 'body', kind: 'textarea', template: true },
      /** Responde en el hilo de este mensaje (id), opcional. */
      { key: 'threadId', kind: 'text', template: true, placeholder: '{{trigger.id}}', advanced: true },
      { key: 'botName', kind: 'text', template: true, placeholder: 'Flow', advanced: true },
    ],
  },
  'app.docs_page': {
    type: 'app.docs_page',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'operation', kind: 'select', options: DOCS_PAGE_OPERATIONS, default: 'page_create' },
      /** Página a cambiar (id o {{variable}}). */
      {
        key: 'pageId',
        kind: 'docsPageRef',
        template: true,
        placeholder: '{{trigger.page.id}}',
        showIf: { key: 'operation', values: ['page_append', 'page_replace', 'page_rename', 'page_archive'] },
      },
      { key: 'title', kind: 'text', template: true, showIf: { key: 'operation', values: ['page_create', 'page_rename'] } },
      /** Markdown: títulos, listas, to-dos, citas, código y tablas. */
      { key: 'content', kind: 'textarea', template: true, showIf: { key: 'operation', values: ['page_create', 'page_append', 'page_replace'] } },
      /** Plantilla del workspace o integrada; sus {{variables}} se completan con los datos del flow. */
      { key: 'templateId', kind: 'docsTemplateRef', showIf: { key: 'operation', values: ['page_create'] } },
      /** Subpágina de (vacío = en la raíz). */
      { key: 'parentId', kind: 'docsPageRef', template: true, showIf: { key: 'operation', values: ['page_create'] } },
    ],
  },
  'app.docs_row': {
    type: 'app.docs_row',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'operation', kind: 'select', options: DOCS_ROW_OPERATIONS, default: 'row_create' },
      /** Base de Docs: "página/bloque". */
      { key: 'database', kind: 'docsDatabaseRef' },
      /** Fila a cambiar: id, o vacío para buscarla por título. */
      { key: 'rowId', kind: 'text', template: true, placeholder: '{{trigger.row.id}}', showIf: { key: 'operation', values: ['row_update'] } },
      /** create: título de la fila nueva. update: busca la fila con este título si no hay id. */
      { key: 'title', kind: 'text', template: true },
      /** Propiedad (nombre) → valor. Select crea la opción si no existe; persona por email. */
      { key: 'values', kind: 'kv', template: true, default: [] },
      /** Cuerpo de la fila en Markdown (update: se agrega al final). */
      { key: 'content', kind: 'textarea', template: true },
      /** Plantilla de fila de la base (nombre). */
      { key: 'template', kind: 'text', placeholder: 'Bug report', showIf: { key: 'operation', values: ['row_create'] }, advanced: true },
      /** update: el título nuevo (si se buscó por título). */
      { key: 'newTitle', kind: 'text', template: true, showIf: { key: 'operation', values: ['row_update'] }, advanced: true },
    ],
  },
  'app.robot_run': {
    type: 'app.robot_run',
    category: 'app',
    outputs: ['out'],
    fields: [
      { key: 'robotId', kind: 'robotRef' },
      { key: 'inputs', kind: 'kv', template: true, default: [] },
      { key: 'failOnError', kind: 'bool', default: true, advanced: true },
      { key: 'retries', kind: 'number', default: 0, advanced: true },
    ],
  },
  'logic.run_flow': {
    type: 'logic.run_flow',
    category: 'logic',
    outputs: ['out'],
    fields: [
      { key: 'flowId', kind: 'flowRef' },
      { key: 'inputs', kind: 'kv', template: true, default: [] },
      { key: 'failOnError', kind: 'bool', default: true, advanced: true },
    ],
  },
  'data.merge': {
    type: 'data.merge',
    category: 'data',
    outputs: ['out'],
    fields: [
      { key: 'mode', kind: 'select', options: ['merge', 'aggregate'], default: 'merge' },
      { key: 'fields', kind: 'kv', template: true, default: [], showIf: { key: 'mode', values: ['merge'] } },
      { key: 'items', kind: 'text', template: true, placeholder: '{{nodes.deals.output.deals}}', showIf: { key: 'mode', values: ['aggregate'] } },
      { key: 'field', kind: 'text', placeholder: 'amount', showIf: { key: 'mode', values: ['aggregate'] } },
      {
        key: 'operation',
        kind: 'select',
        options: ['count', 'sum', 'avg', 'min', 'max', 'collect', 'unique', 'join'],
        default: 'collect',
        showIf: { key: 'mode', values: ['aggregate'] },
      },
    ],
  },
  'data.code': {
    type: 'data.code',
    category: 'data',
    outputs: ['out'],
    fields: [
      {
        key: 'code',
        kind: 'textarea',
        placeholder: 'const total = input.nodes.deals.output.total;\nreturn { total, double: total * 2 };',
        default: 'return { ok: true, trigger: input.trigger };',
      },
      { key: 'timeoutSec', kind: 'number', default: 10, advanced: true },
    ],
  },
  'app.slack': {
    type: 'app.slack',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['slack'] },
      { key: 'channel', kind: 'text', template: true, placeholder: '#sales' },
      { key: 'text', kind: 'textarea', template: true, placeholder: 'New lead: {{trigger.body.email}}' },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'app.google_sheets': {
    type: 'app.google_sheets',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['google', 'oauth_token'] },
      { key: 'operation', kind: 'select', options: ['append', 'read'], default: 'append' },
      { key: 'spreadsheetId', kind: 'text', template: true, placeholder: '1AbC…' },
      { key: 'range', kind: 'text', template: true, placeholder: 'Sheet1', default: 'Sheet1' },
      { key: 'row', kind: 'kv', template: true, default: [], showIf: { key: 'operation', values: ['append'] } },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'app.gmail': {
    type: 'app.gmail',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'to', kind: 'text', template: true, placeholder: '{{trigger.email}}' },
      { key: 'subject', kind: 'text', template: true },
      { key: 'body', kind: 'textarea', template: true },
    ],
  },
  'app.stripe': {
    type: 'app.stripe',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['stripe'] },
      { key: 'operation', kind: 'select', options: ['create_customer', 'list_payments'], default: 'create_customer' },
      { key: 'email', kind: 'text', template: true, placeholder: '{{trigger.email}}', showIf: { key: 'operation', values: ['create_customer'] } },
      { key: 'name', kind: 'text', template: true, showIf: { key: 'operation', values: ['create_customer'] } },
      { key: 'description', kind: 'text', template: true, showIf: { key: 'operation', values: ['create_customer'] } },
      { key: 'limit', kind: 'number', default: 10, showIf: { key: 'operation', values: ['list_payments'] } },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'app.notion': {
    type: 'app.notion',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['notion', 'oauth_token'] },
      { key: 'operation', kind: 'select', options: ['create_page', 'append_text'], default: 'create_page' },
      { key: 'databaseId', kind: 'text', template: true, placeholder: 'database id or URL', showIf: { key: 'operation', values: ['create_page'] } },
      { key: 'title', kind: 'text', template: true, showIf: { key: 'operation', values: ['create_page'] } },
      { key: 'titleProperty', kind: 'text', placeholder: 'Name', default: 'Name', showIf: { key: 'operation', values: ['create_page'] }, advanced: true },
      { key: 'properties', kind: 'textarea', template: true, placeholder: '{"Status": {"select": {"name": "New"}}}', showIf: { key: 'operation', values: ['create_page'] } },
      { key: 'pageId', kind: 'text', template: true, placeholder: 'page id or URL', showIf: { key: 'operation', values: ['append_text'] } },
      { key: 'content', kind: 'textarea', template: true },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'app.discord': {
    type: 'app.discord',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['discord'] },
      { key: 'content', kind: 'textarea', template: true },
      { key: 'username', kind: 'text', template: true, placeholder: 'Zerosoft', advanced: true },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'app.telegram': {
    type: 'app.telegram',
    category: 'integration',
    outputs: ['out'],
    fields: [
      { key: 'credentialId', kind: 'credential', options: ['telegram'] },
      { key: 'chatId', kind: 'text', template: true, placeholder: '-1001234567890' },
      { key: 'text', kind: 'textarea', template: true },
      { key: 'parseMode', kind: 'select', options: ['', 'HTML', 'MarkdownV2'], default: '', advanced: true },
      { key: 'retries', kind: 'number', default: 1, advanced: true },
    ],
  },
  'ai.agent': {
    type: 'ai.agent',
    category: 'ai',
    outputs: ['out'],
    fields: [
      { key: 'agentId', kind: 'agentRef' },
      { key: 'message', kind: 'textarea', template: true, placeholder: '{{trigger.message.body}}' },
      { key: 'conversationId', kind: 'text', template: true, placeholder: '{{nodes.agent_1.output.conversationId}}' },
    ],
  },
  'ai.text': {
    type: 'ai.text',
    category: 'ai',
    outputs: ['out'],
    fields: [
      { key: 'instructions', kind: 'textarea', template: true },
      { key: 'prompt', kind: 'textarea', template: true },
      { key: 'maxTokens', kind: 'number', default: 500, advanced: true },
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

// ---------- Manejo de errores por nodo ----------

/**
 * Qué hace un nodo cuando falla (después de sus reintentos):
 *  - stop: la corrida falla (default).
 *  - continue: el paso queda fallido pero el flow sigue por la salida normal.
 *  - branch: sigue por la salida 'error' (con {{nodes.<id>.output.error}}).
 */
export const ON_ERROR_MODES = ['stop', 'continue', 'branch'] as const;
export type OnErrorMode = (typeof ON_ERROR_MODES)[number];

export function onErrorMode(config: Record<string, unknown> | undefined): OnErrorMode {
  const v = config?.onError;
  return v === 'continue' || v === 'branch' ? v : 'stop';
}

/** Nodos que no admiten manejo de errores (no fallan o no tiene sentido). */
export function supportsErrorHandling(type: string): boolean {
  return !isTriggerType(type) && type !== 'logic.loop' && type !== 'logic.delay';
}

/** Salidas de un nodo concreto (switch: una por caso + default; 'error' si tiene rama de error). */
export function nodeOutputs(node: { type: string; config?: Record<string, unknown> }): string[] {
  let outs: string[];
  if (node.type === 'logic.switch') {
    const cases = Array.isArray(node.config?.cases) ? (node.config?.cases as unknown[]) : [];
    outs = [...cases.map((_, i) => `case-${i}`), 'default'];
  } else {
    outs = [...(nodeDef(node.type)?.outputs ?? [])];
  }
  if (supportsErrorHandling(node.type) && onErrorMode(node.config) === 'branch') outs.push('error');
  return outs;
}

/** Tipos de trigger que reciben HTTP en una URL secreta (/api/flow/hooks/<token>). */
export function isHookTrigger(type: string): boolean {
  return type === 'trigger.webhook' || type === 'trigger.stripe';
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
  | 'delay_in_loop'
  | 'approval_in_loop'
  | 'invalid_cron'
  | 'invalid_timezone';

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
      if (byId.get(id)?.type === 'logic.approval') return { ok: false, error: 'approval_in_loop', nodeId: id };
    }
  }

  const schedule = triggers[0].type === 'trigger.schedule' ? triggers[0] : null;
  if (schedule) {
    const mode = schedule.config.mode;
    const tz = String(schedule.config.timezone ?? '').trim();
    if (mode === 'cron' && !isValidCron(String(schedule.config.cron ?? ''))) {
      return { ok: false, error: 'invalid_cron', nodeId: schedule.id };
    }
    if ((mode === 'cron' || mode === 'daily') && tz && !isValidTimezone(tz)) {
      return { ok: false, error: 'invalid_timezone', nodeId: schedule.id };
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
  /** Flow que corre cuando una corrida falla (null = ninguno). */
  errorFlowId: z.string().max(100).nullable().optional(),
  /** Email al dueño del flow cuando una corrida falla (uno por hora como mucho). */
  failureAlerts: z.boolean().optional(),
  /** Replay automático (una vez) de las corridas que fallan. */
  autoReplay: z.boolean().optional(),
  /** Versión que se editó (bloqueo optimista). */
  version: z.number().int().positive().optional(),
});

export const flowRunSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

/** Probar un paso solo: el nodo (con la config del editor, aunque no esté guardada) y los datos de prueba. */
export const flowStepTestSchema = z.object({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  node: z
    .object({
      type: z.string().refine(isNodeType, { message: 'unknown_node_type' }),
      config: z.record(z.unknown()).default({}),
    })
    .optional(),
  /** { trigger, nodes: { <id>: salida } }; sin esto se arma con lo fijado y la última corrida. */
  context: z
    .object({
      trigger: z.unknown().optional(),
      nodes: z.record(z.unknown()).optional(),
    })
    .optional(),
});

/** Fijar (o soltar con null) la salida de prueba de un nodo. */
export const flowPinSchema = z.object({
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  output: z.unknown(),
});

/** Nodos que no se prueban solos (esperan, repiten un cuerpo o corren otro flow). */
export const UNTESTABLE_NODE_TYPES: readonly string[] = ['logic.loop', 'logic.delay', 'logic.approval', 'logic.run_flow'];

export function isStepTestable(type: string): boolean {
  return !isTriggerType(type) && !UNTESTABLE_NODE_TYPES.includes(type);
}

/** Tope de una salida fijada (JSON) y del total por flow. */
export const PIN_LIMIT = 64_000;
export const PINS_TOTAL_LIMIT = 512_000;

export const flowRerunSchema = z.object({
  /** Nodo desde el que se vuelve a ejecutar (los anteriores reusan su salida). */
  fromNodeId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
});

/** Días que se guarda el historial de corridas (ajuste del workspace). */
export const RETENTION_DAYS = [7, 14, 30, 60, 90, 180, 365] as const;
export const DEFAULT_RETENTION_DAYS = 30;

export const flowSettingsSchema = z.object({
  retentionDays: z
    .number()
    .int()
    .refine((n) => (RETENTION_DAYS as readonly number[]).includes(n))
    .optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

// ---------- Versiones ----------

export interface GraphDiff {
  added: string[];
  removed: string[];
  changed: string[];
  edgesAdded: number;
  edgesRemoved: number;
}

/** Diferencias entre dos grafos (de `before` a `after`). */
export function diffGraphs(before: FlowGraph | null, after: FlowGraph): GraphDiff {
  const prev = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const next = new Map(after.nodes.map((n) => [n.id, n]));
  const added = [...next.keys()].filter((id) => !prev.has(id));
  const removed = [...prev.keys()].filter((id) => !next.has(id));
  const changed = [...next.values()]
    .filter((n) => {
      const p = prev.get(n.id);
      return p && (p.type !== n.type || JSON.stringify(p.config ?? {}) !== JSON.stringify(n.config ?? {}));
    })
    .map((n) => n.id);
  const key = (e: FlowEdge) => `${e.source}:${edgeHandle(e)}->${e.target}`;
  const prevEdges = new Set((before?.edges ?? []).map(key));
  const nextEdges = new Set(after.edges.map(key));
  return {
    added,
    removed,
    changed,
    edgesAdded: [...nextEdges].filter((k) => !prevEdges.has(k)).length,
    edgesRemoved: [...prevEdges].filter((k) => !nextEdges.has(k)).length,
  };
}

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
  {
    key: 'leadToCrmSlack',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'form.submitted' } },
        {
          id: 'contact',
          type: 'app.crm_contact',
          position: P(0, 160),
          config: {
            email: '{{trigger.submission.values.email}}',
            firstName: '{{trigger.submission.values.first_name}}',
            lastName: '',
            source: 'form',
          },
        },
        {
          id: 'slack',
          type: 'app.slack',
          position: P(0, 320),
          config: {
            credentialId: '',
            channel: '#sales',
            text: 'New lead from {{trigger.form.name}}: {{trigger.submission.values.email}} ({{trigger.utm.utm_source | default:direct}})',
            retries: 1,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'contact' },
        { id: 'e2', source: 'contact', target: 'slack' },
      ],
    },
  },
  {
    key: 'bookingToSheets',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'booking.created' } },
        {
          id: 'sheet',
          type: 'app.google_sheets',
          position: P(0, 160),
          config: {
            credentialId: '',
            operation: 'append',
            spreadsheetId: '',
            range: 'Bookings',
            row: [
              { key: 'date', value: '{{trigger.startsAt}}' },
              { key: 'name', value: '{{trigger.invitee.name}}' },
              { key: 'email', value: '{{trigger.invitee.email}}' },
              { key: 'event', value: '{{trigger.eventType.title}}' },
            ],
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'sheet' }],
    },
  },
  {
    key: 'dealWonToStripe',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'deal.won' } },
        {
          id: 'stripe',
          type: 'app.stripe',
          position: P(0, 160),
          config: {
            credentialId: '',
            operation: 'create_customer',
            email: '',
            name: '{{trigger.name}}',
            description: 'Deal {{trigger.id}} won for {{trigger.amount}} {{trigger.currency}}',
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'stripe' }],
    },
  },
  {
    key: 'chatToTrack',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'message.received' } },
        {
          id: 'triage',
          type: 'ai.text',
          position: P(0, 160),
          config: {
            instructions: 'Answer only "bug" if the message reports a bug or an error. Otherwise answer "other".',
            prompt: '{{trigger.message.body}}',
            maxTokens: 10,
          },
        },
        {
          id: 'is_bug',
          type: 'logic.if',
          position: P(0, 320),
          config: { combine: 'all', conditions: [{ left: '{{nodes.triage.output.text | lower}}', op: 'contains', right: 'bug' }] },
        },
        {
          id: 'issue',
          type: 'app.track_issue',
          position: P(0, 480),
          config: {
            projectId: '',
            title: 'Chat: {{trigger.message.body | trim}}',
            description: 'From {{trigger.visitor.email | default:a visitor}} in {{trigger.widget.name}}. Conversation {{trigger.conversation.id}}.',
            priority: 'high',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'triage' },
        { id: 'e2', source: 'triage', target: 'is_bug' },
        { id: 'e3', source: 'is_bug', sourceHandle: 'true', target: 'issue' },
      ],
    },
  },
  {
    key: 'dailyDigestEmail',
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.schedule',
          position: P(0, 0),
          config: { mode: 'cron', cron: '0 8 * * 1-5', timezone: 'UTC', time: '09:00', every: 1, unit: 'hours' },
        },
        { id: 'deals', type: 'app.crm_deals', position: P(0, 160), config: { sinceHours: 24 } },
        {
          id: 'summary',
          type: 'ai.text',
          position: P(0, 320),
          config: {
            instructions: 'Write a short morning digest for a sales team: totals first, then one line per deal. Plain text.',
            prompt: '{{nodes.deals.output.count}} deals, total {{nodes.deals.output.total}}:\n{{nodes.deals.output.deals | json}}',
            maxTokens: 400,
            onError: 'continue',
          },
        },
        {
          id: 'email',
          type: 'app.gmail',
          position: P(0, 480),
          config: {
            to: '',
            subject: 'Daily digest: {{nodes.deals.output.count}} new deals',
            body: '{{nodes.summary.output.text | default:No summary today.}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'deals' },
        { id: 'e2', source: 'deals', target: 'summary' },
        { id: 'e3', source: 'summary', target: 'email' },
      ],
    },
  },
  {
    key: 'robotToSheets',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'robot.run.finished' } },
        {
          id: 'sheet',
          type: 'app.google_sheets',
          position: P(0, 160),
          config: {
            credentialId: '',
            operation: 'append',
            spreadsheetId: '',
            range: 'Robot',
            row: [
              { key: 'at', value: '{{trigger.event.at}}' },
              { key: 'robot', value: '{{trigger.robot.name}}' },
              { key: 'title', value: '{{trigger.output.title}}' },
              { key: 'price', value: '{{trigger.output.price}}' },
            ],
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'sheet' }],
    },
  },
  {
    key: 'stripePaymentToSlack',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.stripe', position: P(0, 0), config: { credentialId: '', events: 'payment_intent.succeeded' } },
        {
          id: 'slack',
          type: 'app.slack',
          position: P(0, 160),
          config: {
            credentialId: '',
            channel: '#revenue',
            text: 'Payment received: {{trigger.data.object.amount}} {{trigger.data.object.currency | upper}} ({{trigger.data.object.id}})',
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'slack' }],
    },
  },
  {
    key: 'issueToDiscord',
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.event',
          position: P(0, 0),
          config: { event: 'issue.created', filterPath: 'issue.priority', filterOp: 'equals', filterValue: 'urgent' },
        },
        {
          id: 'discord',
          type: 'app.discord',
          position: P(0, 160),
          config: {
            credentialId: '',
            content: 'Urgent issue {{trigger.issue.identifier}}: {{trigger.issue.title}} ({{trigger.project.name}})',
            username: 'Track',
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'discord' }],
    },
  },
  {
    key: 'formToTelegram',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'form.submitted' } },
        {
          id: 'telegram',
          type: 'app.telegram',
          position: P(0, 160),
          config: {
            credentialId: '',
            chatId: '',
            text: 'New submission on {{trigger.form.name}}: {{trigger.submission.values | json}}',
            parseMode: '',
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'telegram' }],
    },
  },
  {
    key: 'bookingToNotion',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.event', position: P(0, 0), config: { event: 'booking.created' } },
        {
          id: 'notion',
          type: 'app.notion',
          position: P(0, 160),
          config: {
            credentialId: '',
            operation: 'create_page',
            databaseId: '',
            title: '{{trigger.eventType.title}} with {{trigger.invitee.name}}',
            titleProperty: 'Name',
            properties: '',
            content: 'Starts {{trigger.startsAt}}\n\nAttendee: {{trigger.invitee.email}}\n\nNotes:',
            retries: 1,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'notion' }],
    },
  },
  {
    key: 'webhookAgentReply',
    graph: {
      nodes: [
        { id: 'trigger', type: 'trigger.webhook', position: P(0, 0), config: {} },
        { id: 'agent', type: 'ai.agent', position: P(0, 160), config: { agentId: '', message: '{{trigger.body.question}}', conversationId: '' } },
        {
          id: 'slack',
          type: 'app.slack',
          position: P(0, 320),
          config: {
            credentialId: '',
            channel: '#support',
            text: 'Q: {{trigger.body.question}}\nA: {{nodes.agent.output.reply}}',
            retries: 1,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'agent' },
        { id: 'e2', source: 'agent', target: 'slack' },
      ],
    },
  },
];
