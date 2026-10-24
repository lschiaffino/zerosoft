// Solo tipos: este módulo lo usa el editor (cliente) y crm-workflows toca la DB.
import type { ActionType, TriggerType, WorkflowInput } from './crm-workflows';

/**
 * Catálogo del editor de workflows: triggers y acciones agrupados (para los
 * <optgroup>), qué acciones son avanzadas y las plantillas del asistente.
 * Puro: sin DB ni React, así se testea solo.
 */

export const TRIGGER_GROUPS: Array<{ key: 'contacts' | 'deals' | 'email' | 'other'; types: TriggerType[] }> = [
  { key: 'contacts', types: ['contact_created', 'contact_updated', 'form_submitted', 'score_changed'] },
  { key: 'deals', types: ['deal_created', 'deal_updated', 'deal_stage_changed', 'deal_won', 'deal_lost', 'quote_accepted'] },
  { key: 'email', types: ['email_received', 'email_opened', 'email_clicked', 'meeting_booked'] },
  { key: 'other', types: ['task_due', 'manual'] },
];

/** Acciones del camino básico y las avanzadas (webhook, Flow, si/si no). */
export const ACTION_GROUPS: Array<{ key: 'basic' | 'advanced'; types: ActionType[] }> = [
  {
    key: 'basic',
    types: ['create_task', 'send_email', 'notify_user', 'update_field', 'add_to_list', 'enroll_in_sequence', 'create_activity'],
  },
  { key: 'advanced', types: ['ai_step', 'webhook', 'run_flow', 'branch'] },
];

export const ADVANCED_ACTIONS: readonly ActionType[] = ACTION_GROUPS[1].types;

export function isAdvancedAction(type: string): boolean {
  return (ADVANCED_ACTIONS as readonly string[]).includes(type);
}

export type WorkflowTemplateKey = 'wonTask' | 'welcomeEmail' | 'formAlert' | 'openFollowUp';

export interface WorkflowTemplate {
  key: WorkflowTemplateKey;
  trigger: TriggerType;
  /** Acciones con textos ya traducidos por quien llama (ver `buildTemplate`). */
  actions: Array<{ type: ActionType; config: Record<string, unknown> }>;
}

/**
 * Plantillas del asistente. `copy` trae los textos en el idioma de la
 * persona (asunto de la tarea, cuerpo del email…), así la plantilla queda
 * lista para guardar sin tocar nada.
 */
export function buildTemplate(
  key: WorkflowTemplateKey,
  copy: { taskSubject: string; emailSubject: string; emailBody: string; notifyMessage: string; followUpSubject: string },
): WorkflowTemplate {
  switch (key) {
    case 'wonTask':
      return { key, trigger: 'deal_won', actions: [{ type: 'create_task', config: { subject: copy.taskSubject, dueInDays: 1 } }] };
    case 'welcomeEmail':
      return {
        key,
        trigger: 'contact_created',
        actions: [{ type: 'send_email', config: { to: 'contact', subject: copy.emailSubject, body: copy.emailBody } }],
      };
    case 'formAlert':
      return { key, trigger: 'form_submitted', actions: [{ type: 'notify_user', config: { message: copy.notifyMessage } }] };
    case 'openFollowUp':
      return {
        key,
        trigger: 'email_opened',
        actions: [{ type: 'create_task', config: { subject: copy.followUpSubject, dueInDays: 1 } }],
      };
  }
}

export const TEMPLATE_KEYS: WorkflowTemplateKey[] = ['wonTask', 'welcomeEmail', 'formAlert', 'openFollowUp'];

/** Config vacía razonable para una acción nueva. */
export function defaultActionConfig(type: ActionType): Record<string, unknown> {
  switch (type) {
    case 'create_task':
      return { subject: '', dueInDays: 1 };
    case 'send_email':
      return { to: 'contact', subject: '', body: '' };
    case 'update_field':
    case 'branch':
      return { entity: 'contact' };
    case 'webhook':
      return { method: 'POST' };
    case 'create_activity':
      return { type: 'note' };
    case 'ai_step':
      return { mode: 'prompt', prompt: '', output: 'note' };
    default:
      return {};
  }
}

/**
 * Normaliza la config antes de guardar: los headers del webhook se editan
 * como texto JSON pero el motor espera un objeto (con texto los ignoraba).
 */
export function normalizeActionConfig(type: ActionType, config: Record<string, unknown>): Record<string, unknown> {
  if (type === 'webhook' && typeof config.headers === 'string') {
    const raw = config.headers.trim();
    if (!raw) {
      const { headers: _drop, ...rest } = config;
      void _drop;
      return rest;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...config, headers: parsed };
    } catch {
      // Queda como texto: la validación del editor lo marca.
    }
  }
  return config;
}

export function webhookHeadersValid(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'object') return !Array.isArray(value);
  try {
    const parsed: unknown = JSON.parse(String(value));
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Campos obligatorios de cada acción que siguen vacíos. El asistente no pasa
 * a Revisar ni guarda mientras falte alguno (antes una tarea sin título se
 * guardaba igual).
 */
export function actionMissing(type: ActionType, config: Record<string, unknown> = {}): string[] {
  const empty = (k: string) => {
    const v = config[k];
    return v === undefined || v === null || String(v).trim() === '';
  };
  const need = (...keys: string[]) => keys.filter(empty);
  switch (type) {
    case 'create_task':
      return need('subject');
    case 'send_email':
      return need('to', 'subject', 'body');
    case 'notify_user':
      return need('message');
    case 'update_field':
    case 'branch':
      return need('field');
    case 'add_to_list':
      return need('listId');
    case 'enroll_in_sequence':
      return need('sequenceId');
    case 'run_flow':
      return need('flowId');
    case 'webhook':
      return need('url');
    case 'ai_step': {
      const mode = String(config.mode ?? 'prompt');
      if (mode !== 'prompt') return [];
      return config.output === 'field' ? need('prompt', 'field') : need('prompt');
    }
    default:
      return [];
  }
}

export type WorkflowProblem = 'name' | 'trigger' | 'action' | 'fields' | 'headers';

/** Qué falta para poder guardar (el asistente no deja pasar sin esto). */
export function workflowProblems(input: Pick<WorkflowInput, 'name' | 'triggers' | 'actions'>): WorkflowProblem[] {
  const out: WorkflowProblem[] = [];
  if (!input.name.trim()) out.push('name');
  if (input.triggers.length === 0) out.push('trigger');
  if (input.actions.length === 0) out.push('action');
  if (input.actions.some((a) => actionMissing(a.type, a.config ?? {}).length > 0)) out.push('fields');
  if (input.actions.some((a) => a.type === 'webhook' && !webhookHeadersValid(a.config?.headers))) out.push('headers');
  return out;
}

/** Problemas que frenan el paso Acciones → Revisar (el nombre se pide después). */
export function actionStepProblems(actions: WorkflowInput['actions']): WorkflowProblem[] {
  return workflowProblems({ name: 'x', triggers: [{ type: 'manual' }], actions });
}
