import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { saveBoardScene } from '@/lib/boards';
import { boardSceneSchema } from '@/lib/boards-schema';
import { BOARD_MAX_SCENE_BYTES } from '@/lib/boards-types';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Margen para la miniatura y el sobre JSON por encima del tope de la escena. */
const BODY_SLACK = 512 * 1024;

function tooLarge(bytes: number): NextResponse {
  return NextResponse.json({ error: 'scene_too_large', bytes, max: BOARD_MAX_SCENE_BYTES }, { status: 413 });
}

/**
 * Guarda la escena (autosave). Body: { version, scene, thumbnail? }.
 * 409 si la pizarra cambió en otro lado desde `version`; 413 si es muy grande.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:scene', personId, 120);
  if (limited) return limited;

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > BOARD_MAX_SCENE_BYTES + BODY_SLACK) return tooLarge(declared);
  const raw = await req.text();
  const rawBytes = Buffer.byteLength(raw, 'utf8');
  if (rawBytes > BOARD_MAX_SCENE_BYTES + BODY_SLACK) return tooLarge(rawBytes);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, 'invalid_input');
  }
  const parsed = boardSceneSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  const res = await saveBoardScene(
    user.id,
    personId,
    id,
    parsed.data.scene,
    parsed.data.version,
    parsed.data.thumbnail,
  );
  if (res.ok) return NextResponse.json({ version: res.version, updated_at: res.updated_at });
  if (res.code === 'not_found') return jsonError(404, 'not_found');
  if (res.code === 'too_large') return tooLarge(res.bytes);
  return NextResponse.json(
    { error: 'conflict', version: res.version, updated_at: res.updated_at, updated_by: res.updated_by },
    { status: 409 },
  );
}
