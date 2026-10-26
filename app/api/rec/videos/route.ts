import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createVideo, getVideoRow, listFolders, listVideos, toDto, type RecScope } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { assertLocalStorage, blobUploadEnabled } from '@/lib/rec-upload';
import { BLOB_PART_BYTES, LOCAL_PART_BYTES, isRecVideoType } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Biblioteca: ?scope=mine|workspace|all o ?folder=<id>, con ?q= (título, descripción y transcripción). */
export async function GET(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const sp = req.nextUrl.searchParams;
  const folder = sp.get('folder');
  const raw = sp.get('scope');
  const scope: RecScope = folder
    ? { kind: 'folder', folderId: folder }
    : raw === 'workspace'
      ? { kind: 'workspace' }
      : raw === 'all'
        ? { kind: 'all' }
        : { kind: 'mine' };
  const [videos, folders] = await Promise.all([listVideos(s.actor, scope, sp.get('q') ?? ''), listFolders(s.actor)]);
  return recJson({ videos, folders });
}

const createSchema = z.object({
  title: z.string().max(200).default(''),
  mode: z.enum(['screen_camera', 'screen', 'camera']),
  contentType: z.string().max(80),
  folderId: z.string().max(60).nullable().optional(),
  space: z.enum(['personal', 'workspace']).optional(),
  titleSource: z.enum(['auto', 'user']).optional(),
});

/** Arranca una grabación: crea la fila y dice cómo subir (Blob multipart o partes al servidor). */
export async function POST(req: NextRequest) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isRecVideoType(parsed.data.contentType)) return recJson({ error: 'invalid_input' }, 400);
  try {
    const blob = blobUploadEnabled();
    if (!blob) assertLocalStorage();
    const row = await createVideo(s.actor, parsed.data);
    const full = await getVideoRow(s.actor, row.id);
    return recJson({ video: toDto(full!, s.actor), upload: { mode: blob ? 'blob' : 'local', partBytes: blob ? BLOB_PART_BYTES : LOCAL_PART_BYTES } }, 201);
  } catch (err) {
    return recFail(err);
  }
}
