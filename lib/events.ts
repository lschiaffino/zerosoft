/**
 * Bus de eventos interno. Cada cambio relevante de las apps (reservas, links,
 * contactos, deals, issues, chat, docs) pasa por acá:
 *   1. webhooks salientes (lib/webhooks.ts) — mismo comportamiento de siempre,
 *      solo para los eventos de WEBHOOK_EVENTS;
 *   2. disparadores de Flow (lib/flow.ts) — encola una corrida por cada flow
 *      habilitado con un trigger de ese evento.
 * Nunca lanza: un evento no puede romper la operación que lo originó.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';
import { emitWebhook, WEBHOOK_EVENTS, type WebhookEvent } from './webhooks';
import type { FlowEventType } from './flow-schema';

export type { FlowEventType as EventType } from './flow-schema';

/**
 * Cadena de ejecución de Flow: un flow que crea un contacto emite
 * contact.created y puede disparar otro flow (o a sí mismo). La corrida guarda
 * su profundidad y los flows ya vistos; los eventos emitidos dentro heredan
 * esa cadena. Ver lib/flow.ts (enqueueEventRuns) y MAX_FLOW_CHAIN_DEPTH.
 */
export interface FlowChain {
  depth: number;
  seen: readonly string[];
}

export const flowChain = new AsyncLocalStorage<FlowChain>();

export interface EmitOptions {
  /** Datos extra solo para Flow (no cambian el payload del webhook). */
  extra?: Record<string, unknown>;
  /**
   * Contenido restringido (Docs, un canal privado de Talk): solo lo reciben los webhooks y flows cuya persona
   * creadora pasa este chequeo. Las apps del CRM (Slack) no lo reciben.
   */
  audience?: (creatorId: string | null) => Promise<boolean>;
  /**
   * Datos por destinatario (Docs): para cada webhook o flow, lo que puede ver
   * la persona que lo creó, o null si no puede ver nada (no se le emite). En
   * Flow lo devuelto reemplaza a `data` y a `extra`.
   */
  personalize?: (creatorId: string | null) => Promise<{ data: Record<string, unknown>; extra?: Record<string, unknown> } | null>;
}

/**
 * Emite después de responder (after) si hay un request en curso; si no
 * (scripts, tests), en el momento. Para rutas que no deben esperar a Flow.
 */
export function emitEventSoon(workspaceId: string, type: FlowEventType, data: unknown, opts: EmitOptions = {}): Promise<void> {
  const job = () => emitEvent(workspaceId, type, data, opts);
  try {
    after(job);
    return Promise.resolve();
  } catch {
    return job();
  }
}

export async function emitEvent(
  workspaceId: string,
  type: FlowEventType,
  data: unknown,
  opts: EmitOptions = {},
): Promise<void> {
  if ((WEBHOOK_EVENTS as readonly string[]).includes(type)) {
    await emitWebhook(workspaceId, type as WebhookEvent, data, opts.audience, opts.personalize);
    // Apps del CRM (Slack): mismos eventos que los webhooks (nunca lo restringido).
    if (!opts.audience && !opts.personalize) {
      try {
        const { notifyApps } = await import('./crm-apps');
        await notifyApps(workspaceId, type as WebhookEvent, data);
      } catch {
        /* una app caída no corta el evento */
      }
    }
  }
  // Groups: Slack, Freshdesk y Zoho Desk (lib/groups-integrations.ts).
  if (type.startsWith('groups.')) {
    try {
      const { dispatchGroupsEvent } = await import('./groups-integrations');
      await dispatchGroupsEvent(workspaceId, type, data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[events] groups integrations failed', err);
    }
  }
  try {
    const { enqueueEventRuns } = await import('./flow');
    const payload =
      data && typeof data === 'object' && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>), ...(opts.extra ?? {}) }
        : { data, ...(opts.extra ?? {}) };
    await enqueueEventRuns(workspaceId, type, payload, opts.audience, opts.personalize);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[events] flow enqueue failed', err);
  }
}
