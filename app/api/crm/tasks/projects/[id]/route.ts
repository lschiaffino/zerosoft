import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteTaskProject, updateTaskProject } from '@/lib/crm';
import { taskProjectUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = taskProjectUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const project = await updateTaskProject(user.id, params.id, parsed.data);
  if (!project) return notFound();
  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteTaskProject(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
