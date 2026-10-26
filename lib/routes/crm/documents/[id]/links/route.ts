import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDocumentLink, deleteDocumentLink } from '@/lib/crm-media';
import { json, mediaFail, mediaUser } from '@/lib/crm-media-http';
import { crmError, notFound } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Link de seguimiento del documento para un contacto (o sin contacto). */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const parsed = z.object({ contactId: z.string().max(64).nullish() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return crmError(400, 'invalid_input');
  try {
    return json(await createDocumentLink(u.user.id, id, { contactId: parsed.data.contactId ?? null, createdBy: u.actor }), 201);
  } catch (err) {
    return mediaFail(err);
  }
}

/** Borra un link (?linkId=): deja de abrir y se pierden sus vistas. */
export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const u = await mediaUser();
  if ('res' in u) return u.res;
  const linkId = req.nextUrl.searchParams.get('linkId');
  if (!linkId) return crmError(400, 'invalid_input');
  if (!(await deleteDocumentLink(u.user.id, id, linkId))) return notFound();
  return new NextResponse(null, { status: 204 });
}
