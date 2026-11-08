import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createListView, deleteListView, isListKey, listListViews, updateListView, listAllListViews } from '@/lib/track-list-views';
import { ISSUE_SORTS } from '@/lib/track-views';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vistas guardadas personales de las listas de Track que no son de un team
 * (Issues, My issues, Issues de un project). Una sola ruta estática (no suma
 * rutas dinámicas): el id va en el cuerpo (PATCH) o en ?id= (DELETE).
 */
const viewType = z.enum(['list', 'board', 'calendar', 'gantt']);
const createSchema = z.object({
  key: z.string().refine(isListKey),
  name: z.string().trim().min(1).max(120),
  viewType: viewType.default('list'),
  filters: z.record(z.unknown()).default({}),
  sort: z.enum(ISSUE_SORTS).default('manual'),
});
const updateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120).optional(),
  viewType: viewType.optional(),
  filters: z.record(z.unknown()).optional(),
  sort: z.enum(ISSUE_SORTS).optional(),
});

async function who() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { me: realUserId(user), scope: user.team?.id ?? '' };
}

export async function GET(req: NextRequest) {
  const u = await who();
  if (!u) return unauthorized();
  if (req.nextUrl.searchParams.get('all') === '1') return NextResponse.json({ rows: await listAllListViews(u.me, u.scope) });
  const key = req.nextUrl.searchParams.get('key');
  if (!isListKey(key)) return NextResponse.json({ rows: [] });
  return NextResponse.json({ rows: await listListViews(u.me, u.scope, key) });
}

export async function POST(req: NextRequest) {
  const u = await who();
  if (!u) return unauthorized();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { key, ...input } = parsed.data;
  return NextResponse.json(await createListView(u.me, u.scope, key, input), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const u = await who();
  if (!u) return unauthorized();
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const { id, ...patch } = parsed.data;
  const view = await updateListView(id, u.me, patch);
  return view ? NextResponse.json(view) : notFound();
}

export async function DELETE(req: NextRequest) {
  const u = await who();
  if (!u) return unauthorized();
  const id = req.nextUrl.searchParams.get('id') ?? '';
  return (await deleteListView(id, u.me)) ? NextResponse.json({ ok: true }) : notFound();
}
