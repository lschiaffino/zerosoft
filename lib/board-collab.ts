/**
 * Board: lógica pura del multiplayer en el navegador (sin React ni
 * Excalidraw), para poder testearla. Qué elementos mandar en cada tick,
 * quién sigue conectado y cómo se arma el mapa de colaboradores que dibuja
 * Excalidraw (cursores con nombre, selección y puntero láser).
 */

export type CollabEl = { id: string; version?: number; isDeleted?: boolean };

/** Versión de cada elemento que ya viajó (mandado por acá o recibido de otro). */
export type Broadcasted = Map<string, number>;

/**
 * Elementos que cambiaron desde el último envío (incluidos los borrados, así
 * el borrado viaja). Actualiza `sent` con lo que devuelve. Tope por tick:
 * lo que no entra sale en el próximo.
 */
export function takeChanged<T extends CollabEl>(elements: readonly T[], sent: Broadcasted, max = 1500): T[] {
  const out: T[] = [];
  for (const el of elements) {
    if (!el || typeof el.id !== 'string') continue;
    const v = el.version ?? 0;
    if ((sent.get(el.id) ?? -1) >= v) continue;
    out.push(el);
    if (out.length >= max) break;
  }
  for (const el of out) sent.set(el.id, el.version ?? 0);
  return out;
}

/** Marca como ya viajados los elementos que llegaron de otro (para no devolverlos). */
export function markReceived(elements: readonly CollabEl[], sent: Broadcasted): void {
  for (const el of elements) {
    const v = el.version ?? 0;
    if ((sent.get(el.id) ?? -1) < v) sent.set(el.id, v);
  }
}

export interface PeerUser {
  id: string | null;
  name: string | null;
  guest: boolean;
}

export interface Peer {
  socketId: string;
  user: PeerUser | null;
  pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
  button?: 'up' | 'down';
  selected?: string[];
  bounds?: [number, number, number, number];
  idle?: boolean;
  lastSeen: number;
}

/** Sin noticias de una pestaña en este tiempo, se la da por ida (el latido es cada 10 s). */
export const PEER_TIMEOUT_MS = 30_000;

export function prunePeers(peers: Map<string, Peer>, now: number, timeout = PEER_TIMEOUT_MS): boolean {
  let changed = false;
  for (const [id, p] of peers) {
    if (now - p.lastSeen > timeout) {
      peers.delete(id);
      changed = true;
    }
  }
  return changed;
}

/** Nombre a mostrar: el de la persona, o "Invitado" (traducido) para el link de edición. */
export function peerName(p: Peer, guestLabel: string): string {
  if (p.user?.guest || !p.user) return guestLabel;
  return p.user.name?.trim() || guestLabel;
}

/**
 * Personas distintas conectadas (una persona con dos pestañas cuenta una
 * vez). Los invitados cuentan por pestaña.
 */
export function uniquePeople(peers: Iterable<Peer>): Peer[] {
  const seen = new Set<string>();
  const out: Peer[] = [];
  for (const p of peers) {
    const key = p.user?.id ? `u:${p.user.id}` : `s:${p.socketId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Colaborador en el formato de Excalidraw (appState.collaborators). */
export function toCollaborator(p: Peer, guestLabel: string): Record<string, unknown> {
  const selected: Record<string, true> = {};
  for (const id of p.selected ?? []) selected[id] = true;
  return {
    socketId: p.socketId,
    id: p.user?.id ?? p.socketId,
    username: peerName(p, guestLabel),
    pointer: p.pointer ? { ...p.pointer } : undefined,
    button: p.button ?? 'up',
    selectedElementIds: selected,
    userState: p.idle ? 'away' : 'active',
  };
}

/** Id de esta pestaña para el feed (solo letras, números, - y _). */
export function newSocketId(rand: () => number = Math.random): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(rand() * abc.length)];
  return s;
}

/** Parte de la escena que se ve: [x1, y1, x2, y2] (como getVisibleSceneBounds de Excalidraw). */
export function visibleBounds(a: { scrollX: number; scrollY: number; width: number; height: number; zoom: { value: number } }): [number, number, number, number] {
  const z = a.zoom.value || 1;
  return [-a.scrollX, -a.scrollY, -a.scrollX + a.width / z, -a.scrollY + a.height / z];
}
