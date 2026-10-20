import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createTaskFile, deleteTaskFile, getActivity, listTaskFiles } from '@/lib/crm';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { FileUploadError, storeUploadedFile } from '@/lib/crm-files';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Adjuntos de una actividad (tarea, nota, llamada o reunión). También se sirve
 * en /api/crm/activities/[id]/files.
 */
async function access(id: string) {
  const user = await getCurrentUser();
  if (!user) return { res: unauthorized() } as const;
  const activity = await getActivity(user.id, id);
  if (!activity || !(await canSeeActivity(user.id, id, await sessionScope(user)))) return { res: notFound() } as const;
  return { user, activity } as const;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await access(params.id);
  if ('res' in a) return a.res;
  const rows = await listTaskFiles(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await access(params.id);
  if ('res' in a) return a.res;
  try {
    const stored = await storeUploadedFile(await req.formData().catch(() => null));
    const row = await createTaskFile(params.id, stored);
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof FileUploadError) return crmError(err.status, err.code);
    throw err;
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const a = await access(params.id);
  if ('res' in a) return a.res;

  const fileId = req.nextUrl.searchParams.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (!(await deleteTaskFile(params.id, fileId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
