import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canEditFlows, flowError, forbidden, realUserId, unauthorized } from '@/lib/flow-http';
import { createTable, listTables } from '@/lib/flow-tables';
import { tableCreateSchema } from '@/lib/flow-tables-schema';
import { tableErrorResponse, tableInputError } from '@/lib/flow-tables-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tablas de datos del workspace (cualquier miembro las ve). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ tables: await listTables(user.id), canEdit: canEditFlows(user) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = tableCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return tableInputError(parsed.error);
  try {
    return NextResponse.json({ table: await createTable(user.id, realUserId(user), parsed.data) }, { status: 201 });
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}
