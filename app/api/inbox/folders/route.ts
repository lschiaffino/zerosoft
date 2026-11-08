import { createFolder, listFolders, reorderFolders } from '@/lib/inbox/core';
import { iJson, parseBody, withOwner } from '@/lib/inbox/http';
import { folderCreateSchema, reorderSchema } from '@/lib/inbox/schemas';
import { parseRule } from '@/lib/inbox/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withOwner(async (owner) => iJson({ folders: await listFolders(owner) }));
}

export async function POST(req: Request) {
  return withOwner(async (owner) => {
    const body = await parseBody(req, folderCreateSchema);
    const folder = await createFolder(owner, { ...body, rule: parseRule(body.rule) });
    return iJson({ folder }, 201);
  });
}

/** Orden de las carpetas (arrastrar en la barra). */
export async function PUT(req: Request) {
  return withOwner(async (owner) => {
    const { ids } = await parseBody(req, reorderSchema);
    await reorderFolders(owner, ids);
    return iJson({ folders: await listFolders(owner) });
  });
}
