import { listThreads } from '@/lib/inbox/core';
import { bulkActionSchema } from '@/lib/inbox/schemas';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { threadAction } from '@/lib/inbox/send';
import { isInboxView } from '@/lib/inbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chats de una vista (?view=), una carpeta (?folder=) o una búsqueda (?q=). */
export async function GET(req: Request) {
  return withOwner(async (owner) => {
    const sp = new URL(req.url).searchParams;
    const view = sp.get('view');
    const threads = await listThreads(owner, {
      view: isInboxView(view) ? view : 'inbox',
      folderId: sp.get('folder') || undefined,
      q: sp.get('q') ?? '',
      limit: Number(sp.get('limit') ?? 300) || 300,
    });
    return iJson({ threads });
  });
}

/** La misma acción sobre varios chats (selección múltiple). */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const { ids, ...action } = await parseBody(req, bulkActionSchema);
    const changed = await threadAction(owner, ids, action);
    return iJson({ changed });
  });
}
