import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createFolder, listFolders } from '@/lib/design';
import { designActor, designFail, designJson } from '@/lib/design-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await designActor();
  if ('res' in s) return s.res;
  return designJson({ folders: await listFolders(s.actor) });
}

export async function POST(req: NextRequest) {
  const s = await designActor({ write: true });
  if ('res' in s) return s.res;
  const parsed = z.object({ name: z.string().min(1).max(120) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return designJson({ error: 'invalid_input' }, 400);
  try {
    return designJson({ folder: await createFolder(s.actor, parsed.data.name) }, 201);
  } catch (err) {
    return designFail(err);
  }
}
