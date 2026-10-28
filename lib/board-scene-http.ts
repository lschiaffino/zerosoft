import { NextResponse, type NextRequest } from 'next/server';
import { saveBoardScene } from './boards';
import { boardSceneSchema } from './boards-schema';
import { BOARD_MAX_SCENE_BYTES } from './boards-types';
import { invalidInput, jsonError } from './write-limit';
import { actorKey, bindSocket, publishBoardEvent, validClientSocket } from './board-live';
import { getDb } from './db';

/** Margen para la miniatura y el sobre JSON por encima del tope de la escena. */
const BODY_SLACK = 512 * 1024;

function tooLarge(bytes: number): NextResponse {
  return NextResponse.json({ error: 'scene_too_large', bytes, max: BOARD_MAX_SCENE_BYTES }, { status: 413 });
}

/**
 * PUT de la escena (autosave), compartido por el editor del workspace y el
 * link de invitado. Body: { version, scene, thumbnail? }. 409 si la pizarra
 * cambió desde `version`; 413 si es muy grande.
 */
export async function handleScenePut(
  req: NextRequest,
  workspaceId: string,
  personId: string | null,
  boardId: string,
  /** Link de invitado (para atar el id de pestaña al token). */
  guestToken: string | null = null,
): Promise<NextResponse> {
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

  const res = await saveBoardScene(workspaceId, personId, boardId, parsed.data.scene, parsed.data.version, parsed.data.thumbnail);
  if (res.ok) {
    // Aviso en vivo: las demás pestañas traen la versión guardada (la que guardó lo ignora por su socket).
    const socket = req.headers.get('x-board-socket');
    const key = personId ? actorKey({ kind: 'member', viewer: { workspaceId, personId, isAdmin: false } }) : actorKey({ kind: 'guest', token: guestToken ?? '' });
    const person = personId
      ? ((await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(personId)) as { name: string | null; email: string | null } | undefined)
      : undefined;
    await publishBoardEvent({
      boardId,
      workspaceId,
      socketId: validClientSocket(socket) ? bindSocket(key, socket) : 'server',
      kind: 'saved',
      user: { id: personId, name: person?.name ?? person?.email ?? null, guest: personId === null },
      payload: { version: res.version },
    }).catch(() => undefined);
    return NextResponse.json({ version: res.version, updated_at: res.updated_at });
  }
  if (res.code === 'not_found') return jsonError(404, 'not_found');
  if (res.code === 'too_large') return tooLarge(res.bytes);
  return NextResponse.json(
    { error: 'conflict', version: res.version, updated_at: res.updated_at, updated_by: res.updated_by },
    { status: 409 },
  );
}
