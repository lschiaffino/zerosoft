import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { associate, dissociate, listAssociations, type AssocObject } from '@/lib/crm-assoc';
import { associationRemoveSchema, associationSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: readonly AssocObject[] = ['contact', 'company', 'deal'];

/** GET ?type=contact|company|deal&id=… → todas las asociaciones del registro. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') as AssocObject;
  const id = sp.get('id') ?? '';
  if (!TYPES.includes(type) || !id) return crmError(400, 'invalid_input');
  const list = await listAssociations(user.id, type, id);
  if (!list) return notFound();
  return NextResponse.json(list);
}

/** Asocia (o actualiza primaria/label) dos registros. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = associationSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await catchRef(associate(user.id, parsed.data));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  return NextResponse.json({ ok: true });
}

/** Quita una asociación: body JSON o query (?fromType=&fromId=&toType=&toId=). */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const body: unknown = sp.get('fromType')
    ? Object.fromEntries(['fromType', 'fromId', 'toType', 'toId'].map((k) => [k, sp.get(k) ?? '']))
    : await req.json().catch(() => null);
  const parsed = associationRemoveSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await catchRef(dissociate(user.id, parsed.data));
  if (res instanceof CrmRefError) return crmError(400, res.code);
  if (!res) return notFound();
  return new NextResponse(null, { status: 204 });
}
