/**
 * Track ↔ Linear en vivo: la parte pura de la sincronización (sin base ni
 * red), para probarla sola.
 *
 * - Cada campo sincronizado se lleva a un valor canónico igual en los dos
 *   lados (el status por el nombre del estado de Linear que le corresponde, el
 *   responsable por email solo si existe en los dos lados, los labels por
 *   nombre solo si Linear los tiene). Así, después de mandar un cambio, el
 *   webhook que devuelve Linear trae el mismo valor y no se aplica de vuelta.
 * - resolveField decide campo por campo con la base (el último valor en el
 *   que los dos lados coincidieron): si cambió un solo lado gana ese; si
 *   cambiaron los dos, gana el último que escribió (la hora del cambio en
 *   Track contra el updatedAt de Linear).
 * - La firma de los webhooks de Linear: HMAC-SHA256 en hex del cuerpo crudo
 *   con el secreto del webhook, y el webhookTimestamp a menos de un minuto.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { normalizePriority } from './track-import-map';

export const SYNC_FIELDS = ['title', 'description', 'priority', 'estimate', 'status', 'assignee', 'labels', 'dueDate', 'parent', 'project', 'milestone', 'cycle'] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];
/** Los cycles de Linear son de cada team y se crean allá: entran a Track, no salen. */
export const PUSH_FIELDS: SyncField[] = SYNC_FIELDS.filter((f) => f !== 'cycle');

export type CanonValue = string | number | string[] | null;
export type Canon = Record<SyncField, CanonValue>;

export type LinearDirection = 'two_way' | 'import' | 'push';
export const LINEAR_DIRECTIONS: LinearDirection[] = ['two_way', 'import', 'push'];

export interface LinearStateRef {
  id: string;
  name: string;
  type: string;
  color?: string | null;
  position?: number;
}

export interface LinearLabelRef {
  id: string;
  name: string;
  color?: string | null;
}

/** Lo que hace falta saber de los dos lados para comparar. */
export interface CanonContext {
  /** Estados del team de Linear del issue. */
  states: LinearStateRef[];
  /** Labels que puede usar ese team (del workspace y del team). */
  labels: LinearLabelRef[];
  /** Emails (en minúscula) de las personas de Linear. */
  linearEmails: Set<string>;
  /** Emails (en minúscula) de las personas del workspace de Track. */
  trackEmails: Set<string>;
}

export type TrackPriority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

export function priorityToLinear(p: string | null | undefined): number {
  return p === 'urgent' ? 1 : p === 'high' ? 2 : p === 'medium' ? 3 : p === 'low' ? 4 : 0;
}

export function priorityFromLinear(n: unknown): TrackPriority {
  return normalizePriority(n ?? 0) as TrackPriority;
}

/** Categoría de status de Track → tipo de estado de Linear. */
const TYPE_FOR: Record<string, string> = { backlog: 'backlog', todo: 'unstarted', in_progress: 'started', done: 'completed', cancelled: 'canceled' };

/** Estado de Linear para un status de Track: el del mismo nombre o el primero del mismo tipo. */
export function linearStateFor(status: { name: string | null; category: string | null }, states: LinearStateRef[]): LinearStateRef | null {
  const usable = states.filter((s) => s.type !== 'triage');
  const name = status.name?.trim().toLowerCase();
  if (name) {
    const same = usable.find((s) => s.name.trim().toLowerCase() === name);
    if (same) return same;
  }
  const type = TYPE_FOR[status.category ?? ''];
  if (!type) return null;
  return usable.filter((s) => s.type === type).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))[0] ?? null;
}

export function normalizeMarkdown(md: string | null | undefined): string {
  return String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

function email(e: string | null | undefined, ctx: CanonContext): string | null {
  const v = e?.trim().toLowerCase();
  return v && ctx.linearEmails.has(v) && ctx.trackEmails.has(v) ? v : null;
}

function labelNames(names: Array<string | null | undefined>, ctx: CanonContext): string[] {
  const known = new Set(ctx.labels.map((l) => l.name.trim().toLowerCase()));
  return [...new Set(names.map((n) => String(n ?? '').trim().toLowerCase()).filter((n) => n && known.has(n)))].sort();
}

/** Clave del cycle como la usa el import: "<team>:<nombre o número>". */
export function linearCycleKey(teamName: string, c: { name?: string | null; number?: number | null } | null | undefined): string | null {
  if (!c) return null;
  const label = c.name || (c.number != null ? String(c.number) : '');
  return label ? `${teamName}:${label}` : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- nodo de la API GraphQL de Linear */
/** Issue de Linear (nodo de la API) → valores canónicos. */
export function canonFromLinear(n: any, ctx: CanonContext): Canon {
  const teamName = n.team?.name || n.team?.key || '';
  return {
    title: String(n.title ?? '').trim(),
    description: normalizeMarkdown(n.description),
    priority: priorityFromLinear(n.priority),
    estimate: typeof n.estimate === 'number' ? n.estimate : null,
    status: n.state?.type === 'triage' ? 'triage' : (n.state?.name ?? null),
    assignee: email(n.assignee?.email, ctx),
    labels: labelNames(((n.labels?.nodes ?? []) as any[]).map((l) => l?.name), ctx),
    dueDate: n.dueDate ? String(n.dueDate).slice(0, 10) : null,
    parent: n.parent?.id ?? null,
    project: n.project?.id ?? null,
    milestone: n.projectMilestone?.id ?? null,
    cycle: linearCycleKey(teamName, n.cycle),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Lo que trae un issue de Track (con los ids de Linear ya buscados en el id map). */
export interface TrackSide {
  title: string;
  descriptionMarkdown: string;
  priority: string;
  estimate: number | null;
  statusName: string | null;
  statusCategory: string | null;
  triage: boolean;
  assigneeEmail: string | null;
  labels: string[];
  dueDate: string | null;
  parentLinearId: string | null;
  projectLinearId: string | null;
  milestoneLinearId: string | null;
  cycleKey: string | null;
}

export function canonFromTrack(t: TrackSide, ctx: CanonContext): Canon {
  return {
    title: t.title.trim(),
    description: normalizeMarkdown(t.descriptionMarkdown),
    priority: t.priority || 'none',
    estimate: t.estimate ?? null,
    status: t.triage ? 'triage' : (linearStateFor({ name: t.statusName, category: t.statusCategory }, ctx.states)?.name ?? t.statusName ?? null),
    assignee: email(t.assigneeEmail, ctx),
    labels: labelNames(t.labels, ctx),
    dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null,
    parent: t.parentLinearId,
    project: t.projectLinearId,
    milestone: t.milestoneLinearId,
    cycle: t.cycleKey,
  };
}

export function fieldHash(v: CanonValue): string {
  return createHash('sha256').update(JSON.stringify(v ?? null)).digest('base64url').slice(0, 22);
}

export type FieldDecision = 'same' | 'push' | 'pull';

/**
 * Qué hacer con un campo.
 * - base: hash del último valor acordado (null si nunca se comparó).
 * - localAt: cuándo se cambió en Track sin haberse mandado (null si no hay cambio local).
 * - remoteAt: updatedAt del issue en Linear.
 */
export function resolveField(input: {
  trackHash: string;
  linearHash: string;
  base: string | null;
  localAt: string | null;
  remoteAt: string | null;
  direction: LinearDirection;
}): FieldDecision {
  const { trackHash, linearHash, base, localAt, remoteAt, direction } = input;
  if (trackHash === linearHash) return 'same';
  const trackChanged = localAt != null || (base != null && trackHash !== base);
  // Sin base no se sabe si Linear cambió: cuenta como cambiado (y decide la hora).
  const linearChanged = base == null ? true : linearHash !== base;
  let winner: FieldDecision;
  if (trackChanged && !linearChanged) winner = 'push';
  else if (linearChanged && !trackChanged) winner = 'pull';
  else {
    // Los dos cambiaron: el último que escribió. Un empate lo gana Linear.
    const local = localAt ? Date.parse(localAt) : 0;
    const remote = remoteAt ? Date.parse(remoteAt) : 0;
    winner = local > remote ? 'push' : 'pull';
  }
  if (direction === 'import') return winner === 'push' ? 'same' : winner;
  if (direction === 'push') return winner === 'pull' ? 'same' : winner;
  return winner;
}

// ---------- Webhooks ----------

/** Firma del webhook de Linear (header linear-signature): HMAC-SHA256 en hex del cuerpo crudo. */
export function verifyLinearSignature(rawBody: string, signature: string | null | undefined, secret: string | null | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = signature.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(got) || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'));
}

/** webhookTimestamp (ms) a menos de un minuto (Linear recomienda rechazar los viejos: reenvíos). */
export function webhookIsFresh(timestamp: unknown, now = Date.now(), toleranceMs = 60_000): boolean {
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  return Number.isFinite(ts) && Math.abs(now - ts) <= toleranceMs;
}
