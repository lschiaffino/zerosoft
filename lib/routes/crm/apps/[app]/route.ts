import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import {
  AppError,
  connectAutomation,
  connectSlack,
  connectStripe,
  connectZoom,
  disconnectApp,
  listApps,
  setSlackEvents,
  setStripeWebhookSecret,
} from '@/lib/crm-apps';
import { isCrmApp } from '@/lib/crm-apps-schema';
import { UnsafeUrlError } from '@/lib/safe-fetch';
import { crmError, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ app: string }> };

const events = z.array(z.string().max(60)).max(60).optional();
const connectSchemas = {
  slack: z.object({ webhookUrl: z.string().trim().url().max(500), events, source: z.enum(['crm', 'link']).optional() }),
  zoom: z.object({
    accountId: z.string().trim().min(1).max(200),
    clientId: z.string().trim().min(1).max(200),
    clientSecret: z.string().trim().min(1).max(500),
  }),
  stripe: z.object({ secretKey: z.string().trim().min(1).max(300), webhookSecret: z.string().trim().max(300).optional() }),
  zapier: z.object({ hookUrl: z.string().trim().url().max(1000), events }),
  make: z.object({ hookUrl: z.string().trim().url().max(1000), events }),
} as const;

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { error: unauthorized() } as const;
  if (!isWorkspaceAdmin(user)) return { error: crmError(403, 'forbidden') } as const;
  return { user } as const;
}

function fail(err: unknown) {
  if (err instanceof AppError) return crmError(err.status, err.code);
  if (err instanceof UnsafeUrlError) return crmError(400, err.message);
  throw err;
}

/** Conecta la app (o reemplaza sus credenciales). Solo owners y admins. */
export async function POST(req: NextRequest, props: Ctx) {
  const { app } = await props.params;
  if (!isCrmApp(app)) return notFound();
  const auth = await admin();
  if ('error' in auth) return auth.error;
  const body: unknown = await req.json().catch(() => null);
  const parsed = connectSchemas[app].safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');
  const actor = realUserId(auth.user);
  try {
    const data = parsed.data as unknown as Record<string, string | undefined> & { events?: string[] };
    const str = (k: string) => String(data[k] ?? '');
    if (app === 'slack') {
      await connectSlack(auth.user.id, { webhookUrl: str('webhookUrl'), events: data.events, source: data.source === 'link' ? 'link' : 'crm' }, actor);
    }
    if (app === 'zoom') {
      await connectZoom(auth.user.id, { accountId: str('accountId'), clientId: str('clientId'), clientSecret: str('clientSecret') }, actor);
    }
    if (app === 'stripe') await connectStripe(auth.user.id, { secretKey: str('secretKey'), webhookSecret: data.webhookSecret }, actor);
    if (app === 'zapier' || app === 'make') await connectAutomation(auth.user.id, app, { hookUrl: str('hookUrl'), events: data.events }, actor);
  } catch (err) {
    return fail(err);
  }
  const view = (await listApps(auth.user.id)).find((a) => a.key === app);
  return NextResponse.json({ app: view }, { status: 201 });
}

const patchSchema = z.object({ events, webhookSecret: z.string().trim().max(300).optional() });

/** Ajustes de una app conectada: eventos de Slack o signing secret de Stripe. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { app } = await props.params;
  if (!isCrmApp(app)) return notFound();
  const auth = await admin();
  if ('error' in auth) return auth.error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return crmError(400, 'invalid_input');
  try {
    let ok = false;
    if (app === 'slack' && parsed.data.events) ok = await setSlackEvents(auth.user.id, parsed.data.events);
    if (app === 'stripe' && parsed.data.webhookSecret !== undefined) {
      ok = await setStripeWebhookSecret(auth.user.id, parsed.data.webhookSecret);
    }
    if (!ok) return notFound();
  } catch (err) {
    return fail(err);
  }
  const view = (await listApps(auth.user.id)).find((a) => a.key === app);
  return NextResponse.json({ app: view });
}

/** Desconecta la app y borra sus credenciales (Zapier/Make: también su webhook). */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const { app } = await props.params;
  if (!isCrmApp(app)) return notFound();
  const auth = await admin();
  if ('error' in auth) return auth.error;
  if (!(await disconnectApp(auth.user.id, app))) return notFound();
  return new NextResponse(null, { status: 204 });
}
