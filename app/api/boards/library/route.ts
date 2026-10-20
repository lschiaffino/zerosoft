import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { BOARD_MAX_LIBRARY_BYTES, getBoardLibrary, saveBoardLibrary } from '@/lib/board-library';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ libraryItems: z.array(z.unknown()) });

/** Biblioteca de formas del workspace. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  return NextResponse.json({ libraryItems: await getBoardLibrary(user.id) });
}

/** Guarda la biblioteca entera. Body: { libraryItems } (lo que pasa Excalidraw al adapter). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:library', personId, 60);
  if (limited) return limited;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > BOARD_MAX_LIBRARY_BYTES + 64 * 1024) return jsonError(413, 'library_too_large');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidInput(parsed.error);
  const res = await saveBoardLibrary(user.id, personId, parsed.data.libraryItems);
  if (res.ok) return NextResponse.json({ count: res.count });
  return res.code === 'too_large' ? jsonError(413, 'library_too_large') : jsonError(400, 'invalid_input');
}
