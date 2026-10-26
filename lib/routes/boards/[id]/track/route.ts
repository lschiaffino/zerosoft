import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { isDenied, requireBoardAccess } from '@/lib/board-access-http';
import { getBoardName } from '@/lib/boards';
import { createIssuesFromStickies, listBoardTrackCards, unlinkBoardTrackCard } from '@/lib/board-track';
import { boardTrackCreateSchema } from '@/lib/boards-schema';
import { invalidInput, jsonError, limitWrites } from '@/lib/write-limit';
import { routing } from '@/i18n/routing';
import en from '@/messages/en/board.json';
import es from '@/messages/es/board.json';
import pt from '@/messages/pt/board.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const FROM: Record<string, string> = { en: en.track.fromBoard, es: es.track.fromBoard, pt: pt.track.fromBoard };

/** Tarjetas en vivo de la pizarra: issues ligados a sus elementos, con el estado actual. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'view');
  if (isDenied(access)) return access;
  return NextResponse.json({ cards: await listBoardTrackCards(id) });
}

/** Stickies → issues. Body: { projectId, items: [{ elementId, text }], locale? }. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const { workspaceId, personId } = access.viewer;
  const limited = await limitWrites('boards:track', personId, 30);
  if (limited) return limited;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = boardTrackCreateSchema.safeParse(raw);
  if (!parsed.success) return invalidInput(parsed.error);
  const locale = (routing.locales as readonly string[]).includes(String(raw?.locale)) ? String(raw?.locale) : 'en';
  const res = await createIssuesFromStickies({
    workspaceId,
    teamId: user?.team?.id ?? null,
    personId,
    boardId: id,
    boardName: (await getBoardName(workspaceId, id)) ?? 'Board',
    projectId: parsed.data.projectId,
    items: parsed.data.items,
    fromLabel: FROM[locale] ?? FROM.en,
  });
  if (!res.ok) return jsonError(404, res.code);
  return NextResponse.json({ created: res.created, skipped: res.skipped, cards: await listBoardTrackCards(id) }, { status: 201 });
}

/** Suelta el issue de un sticky: ?element=<id>. El issue no se borra. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await requireBoardAccess(user, id, 'edit');
  if (isDenied(access)) return access;
  const element = req.nextUrl.searchParams.get('element') ?? '';
  if (!element) return jsonError(400, 'invalid_input');
  await unlinkBoardTrackCard(id, element);
  return NextResponse.json({ cards: await listBoardTrackCards(id) });
}
