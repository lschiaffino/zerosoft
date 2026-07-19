import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createTaskProject, listTaskProjects } from '@/lib/crm';
import { taskProjectCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const rows = await listTaskProjects(user.id, true);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = taskProjectCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const project = await createTaskProject(user.id, parsed.data);
  return NextResponse.json(project, { status: 201 });
}
