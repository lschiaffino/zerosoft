import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createBoard, getBoard, listBoards, listTrash, searchBoards } from '@/lib/boards';
import { getBoardFolder } from '@/lib/board-folders';
import { logBoardAudit } from '@/lib/board-audit';
import { emitEventSoon } from '@/lib/events';
import { boardViewer, getBoardAccessInfo } from '@/lib/board-access';
import { boardCreateSchema } from '@/lib/boards-schema';
import { buildTemplateScene, type TemplateText } from '@/lib/board-templates';
import { routing } from '@/i18n/routing';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import en from '@/messages/en/board.json';
import es from '@/messages/es/board.json';
import pt from '@/messages/pt/board.json';

const MESSAGES: Record<string, unknown> = { en, es, pt };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Textos de board.templates del idioma (los mismos que usa la vista previa del cliente). */
function templateText(locale: string): TemplateText {
  const messages = (MESSAGES[locale] ?? MESSAGES.en) as { templates?: Record<string, unknown> };
  return (key) => {
    let node: unknown = messages.templates;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === 'string' ? node : key;
  };
}

/** Pizarras que la persona ve. ?q= busca por nombre y contenido; ?trash=1 trae la papelera. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const p = new URL(req.url).searchParams;
  const viewer = boardViewer(user);
  if (p.get('trash') === '1') return NextResponse.json({ boards: await listTrash(user.id, viewer) });
  const q = p.get('q')?.trim();
  if (q) return NextResponse.json({ boards: await searchBoards(user.id, viewer, q) });
  return NextResponse.json({ boards: await listBoards(user.id, viewer) });
}

/** Crea una pizarra. Body: { name?, template?, locale? } (la plantilla sale con los textos de `locale`). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const personId = user.actingUser?.id ?? user.id;
  const limited = await limitWrites('boards:write', personId, 60);
  if (limited) return limited;
  const parsed = boardCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidInput(parsed.error);
  const { name, template, id } = parsed.data;
  // Pizarra creada sin red (lib/board-sync.ts, syncLocalBoard): si ya llegó, es la misma.
  if (id) {
    const existing = await getBoardAccessInfo(user.id, id);
    if (existing) {
      const board = existing.created_by === personId ? await getBoard(user.id, id) : null;
      return board ? NextResponse.json(board) : jsonError(409, 'id_taken');
    }
  }
  const folderId = parsed.data.folderId && (await getBoardFolder(user.id, parsed.data.folderId)) ? parsed.data.folderId : null;
  let scene;
  if (template) {
    const locale = (routing.locales as readonly string[]).includes(parsed.data.locale ?? '') ? parsed.data.locale! : routing.defaultLocale;
    scene = buildTemplateScene(template, templateText(locale));
  }
  let board;
  try {
    board = await createBoard(user.id, personId, name ?? '', { scene, folderId, id });
  } catch (err) {
    // El id existe en otro workspace (o llegó otro pedido igual en paralelo): no se pisa.
    if (!id) throw err;
    const raced = await getBoardAccessInfo(user.id, id);
    const same = raced?.created_by === personId ? await getBoard(user.id, id) : null;
    return same ? NextResponse.json(same) : jsonError(409, 'id_taken');
  }
  await logBoardAudit({ workspaceId: user.id, actorId: personId, action: 'board.created', boardId: board.id, boardName: board.name, data: template ? { template } : {} });
  await emitEventSoon(user.id, 'board.created', { board: { id: board.id, name: board.name }, createdBy: personId });
  return NextResponse.json(board, { status: 201 });
}
