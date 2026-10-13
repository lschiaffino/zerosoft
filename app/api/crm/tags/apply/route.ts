import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { applyTag } from '@/lib/crm-tags';
import { tagApplySchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = tagApplySchema.extend({ tagId: z.string().min(1).max(64) });

/** Agrega o quita un tag a varios registros (bulk bar de las listas). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { tagId, entity, ids, action } = parsed.data;
  const res = await catchRef(applyTag(user.id, tagId, entity, ids, action));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  return NextResponse.json({ count: res });
}
