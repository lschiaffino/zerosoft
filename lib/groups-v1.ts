/**
 * Groups: helpers de la API pública v1 (/api/v1/groups/**). La key actúa
 * como la persona que la creó: mismo acceso por etiqueta y teléfonos ocultos
 * que en la app. Errores con el formato de la API ({ error: { code, message } }).
 * Server-only.
 */
import type { NextResponse } from 'next/server';
import { apiError, type ApiKeyAuth } from './api-auth';
import { GroupsError } from './groups';
import { ProviderError } from './groups-provider';
import { canSeeChat, groupsViewer, type GroupsViewer } from './groups-access';

export function v1Viewer(auth: ApiKeyAuth): Promise<GroupsViewer> {
  return groupsViewer(auth.user.id, auth.personId, auth.role);
}

/** El chat existe y la key lo puede ver; si no, 404. */
export async function v1Chat(auth: ApiKeyAuth, chatId: string): Promise<{ viewer: GroupsViewer } | { res: NextResponse }> {
  const viewer = await v1Viewer(auth);
  if (!(await canSeeChat(viewer, chatId))) return { res: apiError(404, 'not_found', 'Chat not found.') };
  return { viewer };
}

const MESSAGES: Record<string, string> = {
  not_found: 'Not found.',
  not_a_group: 'This chat is not a group.',
  groups_unsupported: 'This number cannot manage groups (Meta Cloud API). Use a WAHA or Evolution number.',
  polls_unsupported: 'Polls need a WAHA or Evolution number; the Meta Cloud API has no polls.',
  invalid_name: 'Invalid name.',
  invalid_assignee: 'The assignee is not part of the workspace.',
  empty_message: 'The message is empty.',
  no_recipients: 'No valid recipients.',
  invalid_phones: 'No valid phone numbers.',
};

export function v1Error(err: unknown): NextResponse {
  if (err instanceof GroupsError) return apiError(err.status, err.code, MESSAGES[err.code.split(':')[0]] ?? 'Request failed.');
  if (err instanceof ProviderError) return apiError(502, err.code, 'WhatsApp provider error.');
  throw err;
}

export async function v1Json(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
