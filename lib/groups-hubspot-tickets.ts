/**
 * Lines: crear un ticket de HubSpot desde un chat (o desde un ticket de
 * Lines), asociado a la empresa, el contacto y el negocio vinculados al chat.
 * Server-only.
 *
 * Usa el permiso `tickets` de la clave. No se mira la lista de permisos
 * guardada al conectar (puede ser vieja): se intenta y un 403 de HubSpot se
 * informa como `hubspot_missing_scopes:tickets`. Un ticket de Lines que ya
 * se mandó guarda el id (groups_tickets.hubspot_ticket_id) y no se vuelve a
 * crear.
 */
import { getDb } from './db';
import { HubspotError, hubspotClient, requireHubspotConn, type HubspotConn, type HubspotType } from './groups-hubspot';
import { HubspotApiError } from './hubspot/client';

export const HUBSPOT_TICKET_SCOPE = 'tickets';
export const HUBSPOT_TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type HubspotTicketPriority = (typeof HUBSPOT_TICKET_PRIORITIES)[number];

/** Asociaciones ticket → registro definidas por HubSpot. */
const TICKET_ASSOC: Record<HubspotType, number> = { contact: 16, company: 339, deal: 28 };

export interface HubspotTicketPipeline {
  id: string;
  label: string;
  stages: Array<{ id: string; label: string; closed: boolean }>;
}

export interface HubspotTicketRef {
  id: string;
  url: string;
}

/** Pedido a HubSpot sin marcar la conexión como rota: que falte `tickets` no es un problema de la conexión. */
async function call(conn: HubspotConn, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let res;
  try {
    res = await hubspotClient(conn.token).send(path, { method, body });
  } catch (err) {
    if (err instanceof HubspotApiError && err.code === 'scope') throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_TICKET_SCOPE}`, 403);
    if (err instanceof HubspotApiError && (err.code === 'rate_limited' || err.code === 'locked')) throw new HubspotError('hubspot_rate_limited', 429);
    if (err instanceof HubspotApiError && err.code === 'auth') throw new HubspotError('hubspot_invalid_token', 502);
    if (err instanceof HubspotApiError && err.code === 'network') throw new HubspotError('hubspot_unreachable', 502);
    throw new HubspotError('hubspot_error', 502);
  }
  if (res.status === 403) throw new HubspotError(`hubspot_missing_scopes:${HUBSPOT_TICKET_SCOPE}`, 403);
  if (res.status === 401) throw new HubspotError('hubspot_invalid_token', 502);
  if (!res.ok) throw new HubspotError('hubspot_error', 502);
  return (await res.json()) as Record<string, unknown>;
}

export function hubspotTicketUrl(conn: Pick<HubspotConn, 'uiDomain' | 'portalId'>, id: string): string {
  return `https://${conn.uiDomain}/contacts/${conn.portalId}/record/0-5/${id}`;
}

/** Los pipelines de tickets con sus etapas (para elegir dónde cae el ticket). */
export async function hubspotTicketPipelines(ws: string): Promise<HubspotTicketPipeline[]> {
  const conn = await requireHubspotConn(ws);
  const raw = await call(conn, 'GET', '/crm/v3/pipelines/tickets');
  const list = Array.isArray(raw.results) ? (raw.results as Array<Record<string, unknown>>) : [];
  return list
    .filter((p) => !p.archived)
    .map((p) => ({
      id: String(p.id ?? ''),
      label: String(p.label ?? p.id ?? ''),
      stages: (Array.isArray(p.stages) ? (p.stages as Array<Record<string, unknown>>) : [])
        .filter((s) => !s.archived)
        .map((s) => ({ id: String(s.id ?? ''), label: String(s.label ?? s.id ?? ''), closed: String((s.metadata as Record<string, unknown> | undefined)?.isClosed) === 'true' })),
    }))
    .filter((p) => p.id && p.stages.length > 0);
}

export interface CreateHubspotTicketInput {
  subject: string;
  content?: string;
  priority?: string;
  pipeline?: string;
  stage?: string;
  /** El ticket de Lines del que sale: guarda el id y no se crea dos veces. */
  linesTicketId?: string;
}

/**
 * Crea el ticket en HubSpot, asociado a lo que el chat tiene vinculado. El que
 * llama ya chequeó el acceso al chat.
 */
export async function createHubspotTicket(ws: string, chatId: string, input: CreateHubspotTicketInput): Promise<HubspotTicketRef & { created: boolean }> {
  const conn = await requireHubspotConn(ws);
  const db = getDb();
  const chat = (await db.prepare('SELECT id FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, ws)) as { id: string } | undefined;
  if (!chat) throw new HubspotError('not_found', 404);
  if (input.linesTicketId) {
    const t = (await db.prepare('SELECT chat_id, hubspot_ticket_id FROM groups_tickets WHERE id = ? AND user_id = ?').get(input.linesTicketId, ws)) as
      | { chat_id: string | null; hubspot_ticket_id: string | null }
      | undefined;
    if (!t || t.chat_id !== chatId) throw new HubspotError('not_found', 404);
    if (t.hubspot_ticket_id) return { id: t.hubspot_ticket_id, url: hubspotTicketUrl(conn, t.hubspot_ticket_id), created: false };
  }
  const subject = String(input.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 250);
  if (!subject) throw new HubspotError('invalid_title');
  const content = String(input.content ?? '').trim().slice(0, 10_000);
  const priority = HUBSPOT_TICKET_PRIORITIES.find((p) => p === String(input.priority ?? '').toUpperCase());
  // Pipeline y etapa: los elegidos si existen; si no, la primera etapa abierta del primer pipeline.
  const pipelines = await hubspotTicketPipelines(ws);
  const pipeline = pipelines.find((p) => p.id === input.pipeline) ?? pipelines[0];
  if (!pipeline) throw new HubspotError('hubspot_no_ticket_pipeline', 409);
  const stage = pipeline.stages.find((s) => s.id === input.stage) ?? pipeline.stages.find((s) => !s.closed) ?? pipeline.stages[0];
  const links = (await db.prepare('SELECT object_type, object_id FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND missing = 0').all(chatId, ws)) as Array<{
    object_type: HubspotType;
    object_id: string;
  }>;
  const raw = await call(conn, 'POST', '/crm/v3/objects/tickets', {
    properties: {
      subject,
      ...(content ? { content } : {}),
      hs_pipeline: pipeline.id,
      hs_pipeline_stage: stage.id,
      ...(priority ? { hs_ticket_priority: priority } : {}),
    },
    associations: links
      .filter((l) => TICKET_ASSOC[l.object_type] && /^\d{1,20}$/.test(l.object_id))
      .map((l) => ({ to: { id: l.object_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: TICKET_ASSOC[l.object_type] }] })),
  });
  const id = String(raw.id ?? '');
  if (!/^\d{1,20}$/.test(id)) throw new HubspotError('hubspot_error', 502);
  if (input.linesTicketId) {
    // Si dos pedidos llegan juntos, el primero que guarda gana (el otro ticket de HubSpot queda sin vínculo, igual se ve en HubSpot).
    await db.prepare('UPDATE groups_tickets SET hubspot_ticket_id = ? WHERE id = ? AND user_id = ? AND hubspot_ticket_id IS NULL').run(id, input.linesTicketId, ws);
  }
  return { id, url: hubspotTicketUrl(conn, id), created: true };
}
