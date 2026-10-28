import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { createFolder, listFolders } from '@/lib/voice-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Carpetas propias de reuniones (con cuántas reuniones tiene cada una). */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  return NextResponse.json({ folders: await listFolders(auth.owner) });
}

const schema = z.object({ name: z.string().trim().min(1).max(100), parentId: z.string().max(64).nullable().optional() });

/** Carpeta nueva; con parentId, una subcarpeta (un solo nivel). */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  try {
    return NextResponse.json(await createFolder(auth.owner, parsed.data), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
