/**
 * Chat — filtros de la bandeja ↔ vistas guardadas (puro: lo usan el inbox y
 * las rutas). Una vista es un conjunto de filtros con nombre; abrirla deja la
 * bandeja con esos filtros, y "Guardar vista" toma los filtros actuales.
 */

export interface ViewFilters {
  status?: 'open' | 'pending' | 'snoozed' | 'resolved' | 'all';
  /** 'mine', 'unassigned' o un id de agente. */
  assignee?: string;
  teamId?: string;
  tag?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  channel?: 'web' | 'email';
  q?: string;
}

/** Opciones de listChatConversations para una vista, resolviendo "mine" a la persona. */
export function viewListOptions(
  f: ViewFilters,
  me: string,
): { status?: string; assignedTo?: string; teamId?: string; tag?: string; priority?: string; channel?: string; q?: string } {
  return {
    status: f.status && f.status !== 'all' ? f.status : undefined,
    assignedTo: f.assignee === 'mine' ? me : f.assignee || undefined,
    teamId: f.teamId,
    tag: f.tag,
    priority: f.priority,
    channel: f.channel,
    q: f.q,
  };
}

/** Parámetros de /api/chat/conversations para una vista. */
export function viewQuery(f: ViewFilters, me: string): Record<string, string> {
  const o = viewListOptions(f, me);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v) out[k] = v;
  return out;
}

/** Cantidad de filtros activos (para "Guardar vista": sin filtros no hay qué guardar). */
export function activeFilterCount(f: ViewFilters): number {
  return (['status', 'assignee', 'teamId', 'tag', 'priority', 'channel', 'q'] as const).filter((k) => {
    const v = f[k];
    if (!v) return false;
    if (k === 'status' && v === 'open') return false;
    if (k === 'assignee' && v === 'any') return false;
    return true;
  }).length;
}
