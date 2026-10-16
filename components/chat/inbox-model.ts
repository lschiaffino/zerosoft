export type InboxStatus = 'open' | 'pending' | 'snoozed' | 'resolved' | 'all';
export type InboxAssignee = 'any' | 'mine' | 'unassigned';

export const INBOX_STATUSES: InboxStatus[] = ['open', 'pending', 'snoozed', 'resolved', 'all'];
export const INBOX_ASSIGNEES: InboxAssignee[] = ['any', 'mine', 'unassigned'];

export interface InboxFilters {
  status: InboxStatus;
  assignee: InboxAssignee;
  q: string;
  tag: string;
}

/**
 * Parámetros de /api/chat/conversations para los filtros de la bandeja.
 * Estado y asignación son dos ejes: "Mías + Pendientes" es un filtro válido.
 */
export function inboxQuery(f: InboxFilters, widgetIds: string[], currentUserId: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (widgetIds.length > 0) out.widgetIds = widgetIds.join(',');
  if (f.status !== 'all') out.status = f.status;
  if (f.assignee === 'unassigned') out.assignedTo = 'unassigned';
  if (f.assignee === 'mine') out.assignedTo = currentUserId;
  if (f.q) out.q = f.q;
  if (f.tag) out.tag = f.tag;
  return out;
}

/** Filtros guardados en sessionStorage: lo que no se reconoce vuelve al default. */
export function parseSavedFilters(raw: string | null): { status: InboxStatus; assignee: InboxAssignee } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { status?: string; assignee?: string };
    return {
      status: INBOX_STATUSES.includes(v.status as InboxStatus) ? (v.status as InboxStatus) : 'open',
      assignee: INBOX_ASSIGNEES.includes(v.assignee as InboxAssignee) ? (v.assignee as InboxAssignee) : 'any',
    };
  } catch {
    return null;
  }
}

/** Id de la conversación abierta según la ruta (sin locale), o undefined en /app/chat/inbox. */
export function conversationIdFromPath(pathname: string): string | undefined {
  return pathname.match(/\/app\/chat\/inbox\/([^/?#]+)/)?.[1];
}
