import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { createFolder, listFolders } from '@/lib/flow-folders';
import { canEditFlows, flowError, forbidden, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ folders: await listFolders(user.id) });
}

/** Carpeta nueva (solo quien puede editar flows). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z.object({ name: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await createFolder(user.id, realUserId(user), parsed.data.name);
  if (!res.ok) return flowError(400, res.error);
  return NextResponse.json({ folder: res.folder }, { status: 201 });
}
