import { after } from 'next/server';
import { listThreadsPage } from '@/lib/inbox/core';
import { refreshVisible } from '@/lib/inbox/wa-meta';
import { bulkActionSchema } from '@/lib/inbox/schemas';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { threadAction } from '@/lib/inbox/send';
import { isInboxView } from '@/lib/inbox/types';
import { ownerRev, versionTag, versioned } from '@/lib/inbox/revisions';

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
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    // Sin cambios de la persona desde la última vez (una fila): 304 sin armar la lista.
    return versioned(req, versionTag('l', await ownerRev(owner), sp.toString()), () => buildList(owner, sp));
  });
}

async function buildList(owner: string, sp: URLSearchParams) {
  const view = sp.get('view');
  const paged = sp.has('cursor');
  const page = await listThreadsPage(owner, {
    view: isInboxView(view) ? view : 'inbox',
    folderId: sp.get('folder') || undefined,
    q: sp.get('q') ?? '',
    limit: Number(sp.get('limit') ?? (paged ? 60 : 300)) || (paged ? 60 : 300),
    cursor: sp.get('cursor') || null,
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

/** La misma acción sobre varios chats (selección múltiple). */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const { ids, ...action } = await parseBody(req, bulkActionSchema);
    const changed = await threadAction(owner, ids, action);
    return iJson({ changed });
  });
}
