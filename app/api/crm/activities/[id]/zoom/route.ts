import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { AppError, createZoomForActivity } from '@/lib/crm-apps';
import { canSeeActivity, sessionScope } from '@/lib/crm-visibility';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Crea una reunión de Zoom para la actividad (tipo reunión) y deja el link en su cuerpo. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await canSeeActivity(user.id, id, await sessionScope(user)))) return notFound();
  try {
    return NextResponse.json(await createZoomForActivity(user.id, id));
  } catch (err) {
    if (err instanceof AppError) return crmError(err.status, err.code);
    throw err;
  }
}
