/**
 * Groups, bandeja: reglas puras (sin base ni red) de las acciones sobre
 * mensajes, la rotación round-robin y las llamadas. Las usan el servidor
 * (lib/groups-inbox.ts), la UI y los tests.
 */
import type { ProviderCaps } from './groups-provider';

/** WhatsApp deja editar un mensaje durante 15 minutos. */
export const EDIT_WINDOW_MS = 15 * 60_000;
/** Y borrarlo para todos durante unos dos días. */
export const DELETE_WINDOW_MS = 48 * 3_600_000;
/** Mensajes fijados por chat (lo mismo que WhatsApp). */
export const MAX_PINNED = 3;
/** Chats destino de un reenvío. */
export const MAX_FORWARD_TARGETS = 10;

export interface ActionableMessage {
  direction: 'in' | 'out' | 'note' | 'system';
  authorId: string | null;
  authorKind: string;
  body: string;
  media: { url: string; type: string; name: string } | null;
  status: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface MessageActionSet {
  edit: boolean;
  delete: boolean;
  pin: boolean;
  forward: boolean;
}

/** Qué se puede hacer con un mensaje, según el proveedor, quién mira y la hora. */
export function messageActions(
  m: ActionableMessage,
  caps: Pick<ProviderCaps, 'edit' | 'deleteForAll'>,
  viewer: { me: string; isAdmin: boolean },
  now = Date.now(),
): MessageActionSet {
  const none = { edit: false, delete: false, pin: false, forward: false };
  if (m.deletedAt || m.direction === 'system') return none;
  const age = now - Date.parse(m.createdAt);
  if (m.direction === 'note') {
    const own = m.authorId === viewer.me || viewer.isAdmin;
    return { edit: own, delete: own, pin: true, forward: false };
  }
  const delivered = m.status !== 'failed' && m.status !== 'pending';
  const forward = delivered && (Boolean(m.body.trim()) || Boolean(m.media));
  if (m.direction === 'in') return { edit: false, delete: false, pin: true, forward };
  return {
    edit: caps.edit && delivered && !m.media && Boolean(m.body.trim()) && age <= EDIT_WINDOW_MS,
    delete: caps.deleteForAll && delivered && age <= DELETE_WINDOW_MS,
    pin: delivered,
    forward,
  };
}

/**
 * Próxima persona de la rotación: la primera (en orden de id) después de la
 * última asignada. Si la última ya no está (se fue o no está disponible),
 * sigue desde donde habría estado. null si no hay a quién.
 */
export function nextInRotation(candidates: string[], last: string | null | undefined): string | null {
  const sorted = [...new Set(candidates.filter(Boolean))].sort();
  if (sorted.length === 0) return null;
  if (!last) return sorted[0];
  return sorted.find((x) => x > last) ?? sorted[0];
}

export interface AssignRuleLike {
  enabled: boolean;
  numberId: string | null;
  labelId: string | null;
  kind: 'dm' | 'group' | null;
}

/** La regla aplica al chat si cumple todas sus condiciones (las vacías no filtran). */
export function ruleMatches(rule: AssignRuleLike, chat: { numberId: string; kind: 'dm' | 'group'; labelIds: string[] }): boolean {
  if (!rule.enabled) return false;
  if (rule.numberId && rule.numberId !== chat.numberId) return false;
  if (rule.kind && rule.kind !== chat.kind) return false;
  if (rule.labelId && !chat.labelIds.includes(rule.labelId)) return false;
  return true;
}

export type CallStatusLike = 'ringing' | 'answered' | 'ended' | 'missed' | 'rejected';

/** El estado de una llamada nunca vuelve atrás (terminada no pasa a sonando). */
export function callStatusRank(s: string): number {
  return ({ ringing: 1, answered: 2, ended: 3, missed: 3, rejected: 3 } as Record<string, number>)[s] ?? 0;
}

/** "3:07" o "1:02:03". */
export function formatDuration(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Idiomas que ofrece la traducción (código → nombre en inglés para el modelo). */
export const TRANSLATE_LANGS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  hi: 'Hindi',
  ar: 'Arabic',
  id: 'Indonesian',
  tr: 'Turkish',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
};

export function cleanLang(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase().slice(0, 5).split(/[-_]/)[0];
  return v in TRANSLATE_LANGS ? v : null;
}
