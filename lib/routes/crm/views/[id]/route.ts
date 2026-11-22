import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteView, getView, sessionViewViewer, updateView, type ViewWriteError } from '@/lib/crm-views';
import { viewPatchSchema } from '@/lib/crm-views-schema';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function writeError(error: ViewWriteError): NextResponse {
  if (error === 'not_found') return notFound();
  if (error === 'forbidden') return forbidden();
  return crmError(400, error);
}

/** Una vista que la persona ve; 404 si es privada de otra persona o no existe. */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const view = await getView(await sessionViewViewer(user), id);
  return view ? NextResponse.json(view) : notFound();
}

/** Renombrar, cambiar quién la ve o guardar el estado: quien la creó o un admin (403 si la ve y no puede). */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = viewPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await updateView(await sessionViewViewer(user), id, parsed.data);
  return res.ok ? NextResponse.json(res.view) : writeError(res.error);
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const res = await deleteView(await sessionViewViewer(user), id);
  return res.ok ? new NextResponse(null, { status: 204 }) : writeError(res.error);
}
