import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { setRecordTags, tagsForRecords } from '@/lib/crm-tags';
import { recordTagsSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reemplaza los tags de un registro (editor del detalle). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = recordTagsSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { entity, recordId, tagIds } = parsed.data;
  const res = await catchRef(setRecordTags(user.id, entity, recordId, tagIds));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  const tags = await tagsForRecords(user.id, entity, [recordId]);
  return NextResponse.json({ tags: tags.get(recordId) ?? [] });
}
