import { after } from 'next/server';
import { listThreadsPage } from '@/lib/inbox/core';
import { refreshVisible } from '@/lib/inbox/wa-meta';
import { bulkActionSchema, removedActionSchema } from '@/lib/inbox/schemas';
import { iJson, withOwner, withOwnerWs } from '@/lib/inbox/http';
import { internalVersion, loadInternalSet, type InternalSet } from '@/lib/internal-contacts';
import { threadAction } from '@/lib/inbox/send';
import { isInboxView } from '@/lib/inbox/types';
import { ownerRev, versionTag, versioned } from '@/lib/inbox/revisions';
import { purgeThreads, removeThreads, restoreThreads } from '@/lib/inbox/removed';
import { InboxError } from '@/lib/inbox/types';
import { SAME_CHAT_ACTIONS, withInboxSameChatIds } from '@/lib/inbox/same-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chats de una vista (?view=), una carpeta (?folder=) o una búsqueda (?q=).
 * Con ?cursor= (vacío para la primera página) viene paginado: { threads, next, pinned };
 * `next` es el cursor de la página que sigue (null si no hay más) y `pinned`, cuántos
 * fijados vienen adelante en la primera página (no cuentan para ?limit=, hasta 1000).
 * Sin ?cursor=, los primeros ?limit= (300). Con If-None-Match y sin cambios responde 304.
 */
export async function GET(req: Request) {
  return withOwnerWs(async (owner, { ws }) => {
    const sp = new URL(req.url).searchParams;
    // Sin cambios de la persona desde la última vez (una fila): 304 sin armar la lista. Quién es interno es del
    // workspace (lib/internal-contacts.ts): su versión va primero (el resto se corta si es largo) y lo interno se lee
    // solo si hay que armar la lista.
    const iv = await internalVersion(ws);
    return versioned(req, versionTag('l', await ownerRev(owner), `${iv}|${sp.toString()}`), async () => buildList(owner, sp, await loadInternalSet(ws)));
  });
}

async function buildList(owner: string, sp: URLSearchParams, internal: InternalSet) {
  const view = sp.get('view');
  const paged = sp.has('cursor');
  const page = await listThreadsPage(owner, {
    view: isInboxView(view) ? view : 'inbox',
    folderId: sp.get('folder') || undefined,
    q: sp.get('q') ?? '',
    limit: Number(sp.get('limit') ?? (paged ? 60 : 300)) || (paged ? 60 : 300),
    cursor: sp.get('cursor') || null,
    internal,
  });
  const threads = page.threads;
  // Los primeros chats a la vista sin nombre o foto: se piden después de responder (la próxima lista ya los trae).
  const visible =
    paged && sp.get('cursor')
      ? []
      : threads
          .filter((t) => t.channel === 'whatsapp')
          .slice(0, 30)
          .map((t) => t.id);
  if (visible.length) {
    try {
      after(() => refreshVisible(owner, visible).catch(() => null));
    } catch {
      /* fuera de un pedido (tests): lo hace el cron */
    }
  }
  return paged ? { threads, next: page.next, pinned: page.pinned } : { threads };
}

/**
 * La misma acción sobre varios chats (selección múltiple). También sacar de Inbox ('remove'), recuperar
 * ('restore') y borrar del todo uno ya sacado ('purge'; lib/inbox/removed.ts).
 */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const raw: unknown = await req.json().catch(() => null);
    const removed = removedActionSchema.safeParse(raw);
    if (removed.success) {
      const { ids, action } = removed.data;
      const run = action === 'remove' ? removeThreads : action === 'restore' ? restoreThreads : purgeThreads;
      return iJson({ changed: await run(owner, action === 'remove' ? await withInboxSameChatIds(owner, ids) : ids) });
    }
    const parsed = bulkActionSchema.safeParse(raw);
    if (!parsed.success) throw new InboxError('invalid_input', 400);
    const { ids, ...action } = parsed.data;
    // El mismo chat en otras cuentas (una fila en la bandeja): leer, Hecho, archivar, posponer y silenciar valen para todas.
    const targets = (SAME_CHAT_ACTIONS as readonly string[]).includes(action.action) ? await withInboxSameChatIds(owner, ids) : ids;
    const changed = await threadAction(owner, targets, action);
    return iJson({ changed: changed.filter((x) => ids.includes(x)) });
  });
}
