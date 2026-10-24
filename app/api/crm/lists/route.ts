import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { hiddenFieldsFor, sessionFieldViewer } from '@/lib/crm-field-perms';
import type { ListFilterJson } from '@/lib/crm';
import { createList, listLists } from '@/lib/crm';
import { listCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sin reglas sobre campos propios que la persona tiene ocultos (no se adivinan valores con una lista). */
async function allowedFilter(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, filter: ListFilterJson | undefined) {
  if (!filter?.filters?.length) return filter;
  const hidden = await hiddenFieldsFor(sessionFieldViewer(user), 'contacts');
  if (!hidden.size) return filter;
  return { ...filter, filters: filter.filters.filter((r) => !r.f.startsWith('custom:') || !hidden.has(r.f.slice(7))) };
}


export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rows: await listLists(user.id, await sessionScope(user)) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const list = await createList(user.id, { ...parsed.data, filter: await allowedFilter(user, parsed.data.filter) });
  return NextResponse.json(list, { status: 201 });
}
