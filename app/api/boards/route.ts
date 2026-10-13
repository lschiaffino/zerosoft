import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createBoard, listBoards } from '@/lib/boards';
import { boardCreateSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ boards: await listBoards(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = boardCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidInput(parsed.error);
  const board = await createBoard(user.id, personId, parsed.data.name ?? '');
  return NextResponse.json(board, { status: 201 });
}
