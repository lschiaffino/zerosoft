import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getDb } from '@/lib/db';
import { deleteQrTemplate, renameQrTemplate } from '@/lib/link-qr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Renombrar o borrar una plantilla: quien la creó o un admin. */
async function guard(id: string) {
  const user = await getCurrentUser();
  if (!user) return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) } as const;
  const row = (await getDb().prepare('SELECT created_by FROM link_qr_templates WHERE id = ? AND user_id = ?').get(id, user.id)) as
    | { created_by: string | null }
    | undefined;
  if (!row) return { res: NextResponse.json({ error: 'not_found' }, { status: 404 }) } as const;
  if (!isWorkspaceAdmin(user) && row.created_by !== realUserId(user)) {
    return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  }
  return { user } as const;
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = await guard(id);
  if ('res' in g) return g.res;
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await renameQrTemplate(g.user.id, id, parsed.data.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = await guard(id);
  if ('res' in g) return g.res;
  await deleteQrTemplate(g.user.id, id);
  return new NextResponse(null, { status: 204 });
}
