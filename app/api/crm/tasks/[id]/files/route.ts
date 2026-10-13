import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';
import { createTaskFile, deleteTaskFile, getActivity, listTaskFiles } from '@/lib/crm';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const activity = await getActivity(user.id, params.id);
  if (!activity) return notFound();

  const rows = await listTaskFiles(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const activity = await getActivity(user.id, params.id);
  if (!activity) return notFound();

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ error: 'generic' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const contentType = file.type || 'application/octet-stream';

  let url: string;
  try {
    url = await saveUpload('tasks', filename, contentType, buffer);
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }

  const row = await createTaskFile(params.id, {
    filename,
    contentType,
    size: file.size,
    url,
  });

  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const activity = await getActivity(user.id, params.id);
  if (!activity) return notFound();

  const sp = req.nextUrl.searchParams;
  const fileId = sp.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (!(await deleteTaskFile(params.id, fileId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
