/**
 * Chat — sesión de las rutas del inbox: el workspace (dueño, donde viven los
 * datos), la persona real, sus widgets y los agentes. Server-only.
 */
import { NextResponse } from 'next/server';
import { listAccessibleChatWidgets } from './chat-access';
import { getCurrentUser, isWorkspaceAdmin, realUserId, type SessionUser } from './session';
import { listChatAgents, listChatWidgets, type ChatAgent } from './chat-data';
import { ChatCollabError } from './chat-collab';
import { limitWrites } from './write-limit';
import type { ChatWidgetRow } from './db';

export interface ChatSession {
  user: SessionUser;
  /** Dueño del workspace (chat_widgets.user_id). */
  ws: string;
  /** Persona real. */
  me: string;
  isAdmin: boolean;
  widgets: ChatWidgetRow[];
  agents: ChatAgent[];
}

export function chatError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function chatSession(opts: { write?: boolean; admin?: boolean } = {}): Promise<ChatSession | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return chatError(401, 'unauthorized');
  const me = realUserId(user);
  const isAdmin = isWorkspaceAdmin(user);
  if (opts.admin && !isAdmin) return chatError(403, 'forbidden');
  if (opts.write) {
    const limited = await limitWrites('chat', me);
    if (limited) return limited;
  }
  const widgets = await listAccessibleChatWidgets(user);
  const agents = await listChatAgents(user.id, user.team?.id ?? null);
  return { user, ws: user.id, me, isAdmin, widgets, agents };
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function collabError(err: unknown): NextResponse {
  if (err instanceof ChatCollabError) return chatError(err.status, err.code);
  throw err;
}

/** Widgets del workspace que esta persona no ve (bandejas restringidas). */
export async function hiddenWidgetIds(s: ChatSession): Promise<Set<string>> {
  const visible = new Set(s.widgets.map((w) => w.id));
  return new Set((await listChatWidgets(s.user.id, s.user.team?.id ?? null)).map((w) => w.id).filter((id) => !visible.has(id)));
}
