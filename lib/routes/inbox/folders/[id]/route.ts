import { deleteFolder, listFolders, moveFolder, updateFolder } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { folderPatchSchema } from '@/lib/inbox/schemas';
import { parseRule } from '@/lib/inbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const { move, ...body } = await parseBody(req, folderPatchSchema);
    if (move) await moveFolder(owner, id, move.parentId, move.before);
    await updateFolder(owner, id, { ...body, rule: body.rule === undefined ? undefined : parseRule(body.rule) });
    return iJson({ folders: await listFolders(owner) });
  });
}

/** Borra la carpeta (los chats quedan; las subcarpetas suben un nivel). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await deleteFolder(owner, id);
    return iJson({ folders: await listFolders(owner) });
  });
}
