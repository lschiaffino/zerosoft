import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getCurrentUser } from '@/lib/session';
import { createTaskFile, deleteTaskFile, getActivity, listTaskFiles } from '@/lib/crm';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function saveLocalFile(id: string, filename: string, buffer: Buffer): Promise<string> {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'tasks');
  await mkdir(uploadsDir, { recursive: true });
  const safeName = `${id}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const filePath = path.join(uploadsDir, safeName);
  await writeFile(filePath, buffer);
  return `/uploads/tasks/${safeName}`;
}

async function saveBlob(filename: string, buffer: Buffer): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await eval('require')('@vercel/blob');
    const blob = await mod.put(`tasks/${crypto.randomUUID()}-${filename}`, buffer, {
      access: 'public',
      contentType: undefined,
    });
    return blob.url;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const activity = await getActivity(user.id, params.id);
  if (!activity) return notFound();

  const rows = await listTaskFiles(params.id);
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'generic' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = (file as File).name || 'upload';
  const contentType = file.type || 'application/octet-stream';

  let url = await saveBlob(filename, buffer);
  if (!url) {
    url = await saveLocalFile(params.id, filename, buffer);
  }

  const row = await createTaskFile(params.id, {
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

  const activity = await getActivity(user.id, params.id);
  if (!activity) return notFound();

  const sp = req.nextUrl.searchParams;
  const fileId = sp.get('fileId');
  if (!fileId) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (!(await deleteTaskFile(params.id, fileId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
