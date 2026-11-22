import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { createList } from '@/lib/crm';
import { hiddenContactFields, listsForViewer, withoutHiddenRules } from '@/lib/crm-list-access';
import { listCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Las listas que la persona ve, con los conteos de lo que ve (lib/crm-list-access.ts). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listsForViewer(sessionFieldViewer(user), await sessionScope(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  // Sin reglas sobre campos que la persona tiene ocultos (no se adivinan valores con una lista).
  const filter = withoutHiddenRules(parsed.data.filter, await hiddenContactFields(sessionFieldViewer(user)));
  const list = await createList(user.id, { ...parsed.data, filter });
  return NextResponse.json(list, { status: 201 });
}
