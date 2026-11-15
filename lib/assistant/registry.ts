/**
 * Registro tipado de herramientas del asistente.
 *
 * Cada herramienta declara su app (`app`), si es de administración (`admin`)
 * o si necesita todas las apps (`allApps`, como los webhooks que cruzan
 * apps). `toolsFor(user)` arma la lista con el rol y el acceso por app de la
 * sesión (team_members.apps): una persona sin CRM no recibe herramientas del
 * CRM, un member nunca recibe las de admin y un guest no recibe ninguna.
 *
 * Lectura (`kind: 'read'`): corre en el turno y su resultado pasa por
 * redact() antes de volver al modelo.
 * Escritura (`kind: 'write'`): en el turno solo `prepare` (valida y arma el
 * resumen); `execute` corre recién desde POST /api/assistant/actions/<id>
 * cuando la persona hace clic en Confirmar, con la sesión de ese momento.
 */
import type { z } from 'zod';
import type { SessionUser } from '../session';
import type { ProductKey } from '../products';
import { roleAtLeast } from '../teams';
import { hasAllApps, userCanUseApp } from '../workspace';

export interface ToolCtx {
  user: SessionUser;
  /** Owner del workspace activo: clave de los datos de todas las apps. */
  workspaceId: string;
  /** Persona real (no el owner). */
  personId: string;
  locale: string;
  isAdmin: boolean;
  /** La charla del turno (las herramientas que leen lo que la persona pegó o adjuntó). */
  conversationId?: string;
}

export interface PreparedAction {
  summary: string;
  /** Lo que cambia, para la tarjeta de confirmación (antes → después). */
  details: Array<{ label: string; before?: string | null; after: string }>;
  /** Acciones destructivas: lo que la persona tiene que tipear para confirmar (null: alcanza con el botón). */
  confirmText?: string | null;
  /** Input normalizado que se guarda y se ejecuta (ids resueltos, etc.). */
  input?: Record<string, unknown>;
  /** Texto del botón mientras corre ("Creando 12 carpetas…"). */
  working?: string;
  /** Esta acción en particular es destructiva aunque la herramienta no siempre lo sea. */
  destructive?: boolean;
  /** Lo que vuelve al modelo además del resumen (el plan, para explicarlo y preguntar). */
  forModel?: unknown;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  href?: string;
  error?: string;
  /** Se hizo una parte: el mensaje dice qué faltó y que repetir solo hace eso. */
  partial?: boolean;
}

interface BaseTool<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  /** App a la que pertenece. null = de la plataforma (charlas, búsqueda, ajustes propios). */
  app: ProductKey | null;
  /** Solo admins y owner del workspace. */
  admin?: boolean;
  /** Necesita todas las apps (ajustes que cruzan apps, como los webhooks). */
  allApps?: boolean;
  input: S;
}

export interface ReadTool<S extends z.ZodTypeAny = z.ZodTypeAny> extends BaseTool<S> {
  kind: 'read';
  run(ctx: ToolCtx, input: z.infer<S>): Promise<unknown>;
}

export interface WriteTool<S extends z.ZodTypeAny = z.ZodTypeAny> extends BaseTool<S> {
  kind: 'write';
  destructive?: boolean;
  prepare(ctx: ToolCtx, input: z.infer<S>): Promise<PreparedAction | { error: string; hint?: unknown }>;
  execute(ctx: ToolCtx, input: Record<string, unknown>): Promise<ActionResult>;
}

export type AssistantTool = ReadTool | WriteTool;

export function readTool<S extends z.ZodTypeAny>(t: Omit<ReadTool<S>, 'kind'>): ReadTool {
  return { ...t, kind: 'read' } as unknown as ReadTool;
}

export function writeTool<S extends z.ZodTypeAny>(t: Omit<WriteTool<S>, 'kind'>): WriteTool {
  return { ...t, kind: 'write' } as unknown as WriteTool;
}

/** ¿La sesión puede usar esta herramienta? (rol, apps del workspace activo). */
export function canUseTool(user: Pick<SessionUser, 'role' | 'apps'>, t: Pick<AssistantTool, 'app' | 'admin' | 'allApps'>): boolean {
  const role = user.role ?? 'owner';
  if (role === 'guest') return false;
  if (t.admin && !roleAtLeast(role, 'admin')) return false;
  if (t.allApps && !hasAllApps(user)) return false;
  if (t.app && !userCanUseApp(user, t.app)) return false;
  return true;
}

export function toolCtx(user: SessionUser, locale: string): ToolCtx {
  return {
    user,
    workspaceId: user.id,
    personId: user.actingUser?.id ?? user.id,
    locale,
    isAdmin: roleAtLeast(user.role ?? 'owner', 'admin'),
  };
}
