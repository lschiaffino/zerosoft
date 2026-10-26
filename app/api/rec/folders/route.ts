import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createFolder, listFolders } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await recActor();
  if ('res' in s) return s.res;
  return recJson({ folders: await listFolders(s.actor) });
}

const schema = z.object({ name: z.string().max(120), space: z.enum(['personal', 'workspace']) });

export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    return recJson({ folder: await createFolder(s.actor, parsed.data) }, 201);
  } catch (err) {
    return recFail(err);
  }
}
