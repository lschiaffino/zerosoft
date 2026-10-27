import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';
import { deleteTableRow, updateTableRow } from '@/lib/flow-tables';
import { tableRowSchema } from '@/lib/flow-tables-schema';
import { tableErrorResponse } from '@/lib/flow-tables-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; rowId: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, rowId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = tableRowSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  try {
    const row = await updateTableRow(user.id, id, rowId, parsed.data.data);
    return row ? NextResponse.json({ row }) : notFound();
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, rowId } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  try {
    return (await deleteTableRow(user.id, id, rowId)) ? new NextResponse(null, { status: 204 }) : notFound();
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}
