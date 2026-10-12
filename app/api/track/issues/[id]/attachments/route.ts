import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { MAX_UPLOAD_SIZE, saveUpload, UploadError } from '@/lib/uploads';
import { createIssueAttachment, deleteIssueAttachment, getIssue, getProject, listIssueAttachments, canAccessTrackProject } from '@/lib/track-data';
import { notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function accessibleIssue(id: string, teamId: string | null, ownerId: string) {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project) return null;
  if (!canAccessTrackProject(project, teamId, ownerId)) return null;
  return issue;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const rows = await listIssueAttachments(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

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
    url = await saveUpload('track', filename, contentType, buffer);
  } catch (err) {
    if (err instanceof UploadError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }

  const row = await createIssueAttachment(params.id, user.id, {
    filename,
    contentType,
    size: file.size,
    url,
  });

  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const issue = await accessibleIssue(params.id, user.team?.id ?? null, user.id);
  if (!issue) return notFound();

  const sp = req.nextUrl.searchParams;
  const fileId = sp.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (!(await deleteIssueAttachment(fileId, issue.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
