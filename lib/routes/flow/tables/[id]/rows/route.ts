import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canEditFlows, flowError, forbidden, unauthorized } from '@/lib/flow-http';
import { insertTableRow, listTableRows } from '@/lib/flow-tables';
import { tableRowSchema } from '@/lib/flow-tables-schema';
import { tableErrorResponse } from '@/lib/flow-tables-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Filas de una tabla, de la más nueva a la más vieja (?limit, ?offset). */
export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await listTableRows(user.id, id, { limit: Number(sp.get('limit')) || 100, offset: Number(sp.get('offset')) || 0 }),
    );
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = tableRowSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  try {
    return NextResponse.json({ row: await insertTableRow(user.id, id, parsed.data.data) }, { status: 201 });
  } catch (err) {
    return tableErrorResponse(err) ?? flowError(500, 'generic');
  }
}
