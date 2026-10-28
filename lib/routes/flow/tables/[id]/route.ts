import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';
import { deleteTable, getTable, updateTable } from '@/lib/flow-tables';
import { tableUpdateSchema } from '@/lib/flow-tables-schema';
import { tableErrorResponse, tableInputError } from '@/lib/flow-tables-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const table = await getTable(user.id, id);
  return table ? NextResponse.json({ table }) : notFound();
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = tableUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return tableInputError(parsed.error);
  try {
    return NextResponse.json({ table: await updateTable(user.id, id, parsed.data) });
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  return (await deleteTable(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
