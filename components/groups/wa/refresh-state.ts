/**
 * Los estados de "Traer mensajes que faltan" (RefreshMissing.tsx), sin React: lo que respondió el servidor y lo que
 * se vio al mirar se convierten en lo que dice la franja.
 */

export type RefreshState = 'idle' | 'loading' | 'done' | 'none' | 'noanswer' | 'offline' | 'limited' | 'outdated' | 'error';

/** Lo que respondió el servidor al pedido. */
export interface RefreshReply {
  status: number;
  error?: string;
  requests?: number;
  delivered?: number;
  answered?: boolean;
  recent?: boolean;
  empty?: boolean;
}

/** Cómo va el pedido (refreshStatus). */
export interface RefreshProgress {
  state: 'idle' | 'waiting' | 'done';
  added?: number;
  answered?: boolean;
}

/** El estado final a partir de lo que respondió el pedido (los errores). Null: el pedido salió, hay que mirar. */
export function replyState(r: RefreshReply): RefreshState | null {
  if (r.status === 409) return 'offline';
  if (r.status === 429) return 'limited';
  if (r.status === 502 && r.error === 'history_gateway_outdated') return 'outdated';
  if (r.status < 200 || r.status >= 300) return 'error';
  if (r.empty) return 'none';
  return null;
}

/** El estado final cuando terminó de mirar: trajo, no faltaba nada (el teléfono respondió) o no respondió. */
export function finalState(added: number, answered: boolean): RefreshState {
  if (added > 0) return 'done';
  return answered ? 'none' : 'noanswer';
}
