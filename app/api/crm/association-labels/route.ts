import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';
import {
  ASSOC_LABEL_PAIRS,
  createAssociationLabel,
  deleteAssociationLabel,
  isAssocLabelPair,
  listAssociationLabels,
  MAX_ASSOC_LABEL_NAME,
  renameAssociationLabel,
} from '@/lib/crm-assoc-labels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  pair: z.enum(ASSOC_LABEL_PAIRS),
  name: z.string().trim().min(1).max(MAX_ASSOC_LABEL_NAME),
});
const renameSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(MAX_ASSOC_LABEL_NAME),
});

/** GET ?pair=contact_company|deal_contact → labels propios del workspace (todos los ven: los usa la ficha). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const raw = req.nextUrl.searchParams.get('pair');
  if (raw !== null && !isAssocLabelPair(raw)) return crmError(400, 'invalid_input');
  const pair = isAssocLabelPair(raw) ? raw : undefined;
  return NextResponse.json({ rows: await listAssociationLabels(user.id, pair) });
}

/** Crea un label (owner/admin): configuración compartida del workspace. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const row = await catchRef(createAssociationLabel(user.id, parsed.data.pair, parsed.data.name));
  if (row instanceof CrmRefError) return crmError(400, row.code);
  return NextResponse.json(row, { status: 201 });
}

/** Renombra un label (owner/admin). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const row = await catchRef(renameAssociationLabel(user.id, parsed.data.id, parsed.data.name));
  if (row instanceof CrmRefError) return crmError(400, row.code);
  if (!row) return notFound();
  return NextResponse.json(row);
}

/** Borra un label (owner/admin): ?id=. Las asociaciones que lo usaban quedan sin label. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return crmError(400, 'invalid_input');
  if (!(await deleteAssociationLabel(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
