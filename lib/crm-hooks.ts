/**
 * Eventos del CRM que salen a webhooks y apps conectadas (Slack) pero que no
 * son disparadores de Flow: cambio de propiedad, borrados, empresas, pago de
 * cotización. Los que sí son de Flow pasan por lib/events.ts (emitEvent), que
 * también avisa a las apps. Nunca lanza.
 */
import { after } from 'next/server';
import { emitWebhook, type WebhookEvent } from './webhooks';

export async function emitCrmHook(workspaceId: string, event: WebhookEvent, data: unknown): Promise<void> {
  try {
    await emitWebhook(workspaceId, event, data);
    const { notifyApps } = await import('./crm-apps');
    await notifyApps(workspaceId, event, data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[crm-hooks] emit failed', err);
  }
}

/** Después de responder si hay request (no demora la operación); si no, en el momento. */
export function emitCrmHookSoon(workspaceId: string, event: WebhookEvent, data: unknown): Promise<void> {
  const job = () => emitCrmHook(workspaceId, event, data);
  try {
    after(job);
    return Promise.resolve();
  } catch {
    return job();
  }
}

/** Fila de la DB → payload de webhook: sin user_id y con custom parseado. */
export function recordPayload(row: Record<string, unknown>): Record<string, unknown> {
  const { user_id: _owner, ...data } = row;
  let custom: unknown = {};
  if (typeof data.custom === 'string') {
    try {
      custom = JSON.parse(data.custom);
    } catch {
      custom = {};
    }
  }
  return { ...data, ...(data.custom !== undefined ? { custom } : {}) };
}
