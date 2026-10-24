import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { AppError, sendSlackTest, syncStripeCustomers } from '@/lib/crm-apps';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Acciones de una app: slack/test (mensaje de prueba) y stripe/sync (clientes → contactos). */
export async function POST(_req: NextRequest, props: { params: Promise<{ app: string; action: string }> }) {
  const { app, action } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return crmError(403, 'forbidden');
  try {
    if (app === 'slack' && action === 'test') {
      if (!(await sendSlackTest(user.id))) return notFound();
      return NextResponse.json({ ok: true });
    }
    if (app === 'stripe' && action === 'sync') {
      return NextResponse.json(await syncStripeCustomers(user.id));
    }
  } catch (err) {
    if (err instanceof AppError) return crmError(err.status, err.code);
    throw err;
  }
  return notFound();
}
