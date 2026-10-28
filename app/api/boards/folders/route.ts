import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { boardViewer } from '@/lib/board-access';
import { createBoardFolder, listBoardFolders } from '@/lib/board-folders';
import { logBoardAudit } from '@/lib/board-audit';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const folderNameSchema = z.object({ name: z.string().trim().min(1).max(80) });

/** Carpetas del workspace, con cuántas pizarras (que la persona ve) tiene cada una. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ folders: await listBoardFolders(user.id, boardViewer(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = folderNameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const res = await createBoardFolder(user.id, personId, parsed.data.name);
  if (!res.ok) return jsonError(400, res.code);
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'folder.created', data: { id: res.folder.id, name: res.folder.name } });
  return NextResponse.json(res.folder, { status: 201 });
}
