import { createSnippet, listSnippets } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { snippetCreateSchema } from '@/lib/inbox/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withOwner(async (owner) => iJson({ snippets: await listSnippets(owner) }));
}

export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const body = await parseBody(req, snippetCreateSchema);
    return iJson({ snippet: await createSnippet(owner, body) }, 201);
  });
}
