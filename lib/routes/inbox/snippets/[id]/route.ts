import { deleteSnippet, listSnippets, updateSnippet } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { snippetPatchSchema } from '@/lib/inbox/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await updateSnippet(owner, id, await parseBody(req, snippetPatchSchema));
    return iJson({ snippets: await listSnippets(owner) });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    await deleteSnippet(owner, id);
    return iJson({ snippets: await listSnippets(owner) });
  });
}
