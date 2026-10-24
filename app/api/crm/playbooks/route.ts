import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { createPlaybook, listPlaybooks } from '@/lib/crm-playbooks';
import { PLAYBOOK_ENTITIES, playbookCreateSchema, type PlaybookEntity } from '@/lib/crm-playbooks-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Playbooks del workspace (?entity= los que se ofrecen en ese tipo de registro, ?q= por nombre). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const entity = sp.get('entity');
  const rows = await listPlaybooks(user.id, {
    q: sp.get('q') ?? undefined,
    entity: entity && (PLAYBOOK_ENTITIES as readonly string[]).includes(entity) ? (entity as PlaybookEntity) : undefined,
  });
  return NextResponse.json({ rows });
}

/** Nuevo playbook (admins del workspace). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = playbookCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createPlaybook(user.id, parsed.data, realUserId(user)), { status: 201 });
}
