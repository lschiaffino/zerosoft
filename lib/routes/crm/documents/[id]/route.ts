import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteDocument, getDocument, listDocumentLinks, renameDocument } from '@/lib/crm-media';
import { canManage, json, mediaFail, mediaUser } from '@/lib/crm-media-http';
import { crmError, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const doc = await getDocument(u.user.id, id);
  if (!doc) return notFound();
  return json({ document: doc, links: await listDocumentLinks(u.user.id, id) });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const doc = await getDocument(u.user.id, id);
  if (!doc) return notFound();
  if (!canManage(u, doc.created_by)) return crmError(403, 'forbidden');
  const parsed = z.object({ name: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  try {
    return json(await renameDocument(u.user.id, id, parsed.data.name));
  } catch (err) {
    return mediaFail(err);
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const doc = await getDocument(u.user.id, id);
  if (!doc) return notFound();
  if (!canManage(u, doc.created_by)) return crmError(403, 'forbidden');
  await deleteDocument(u.user.id, id);
  return new NextResponse(null, { status: 204 });
}
