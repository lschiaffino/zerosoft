import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import {
  connectLinkIntegration,
  disconnectLinkIntegration,
  IntegrationError,
  LINK_INTEGRATIONS,
  listLinkIntegrations,
  type LinkIntegrationKey,
} from '@/lib/link-integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const connectSchema = z.object({ kind: z.enum(LINK_INTEGRATIONS), secret: z.string().trim().min(1).max(300) });

async function admin() {
  const user = await getCurrentUser();
  if (!user) return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isWorkspaceAdmin(user)) return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) } as const;
  return { user } as const;
}

/** Shopify y Segment de Link (sin secretos: solo pistas enmascaradas). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ integrations: await listLinkIntegrations(user.id) });
}

export async function POST(req: NextRequest) {
  const a = await admin();
  if ('res' in a) return a.res;
  const parsed = connectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    await connectLinkIntegration(a.user.id, parsed.data.kind, { secret: parsed.data.secret }, realUserId(a.user));
  } catch (err) {
    if (err instanceof IntegrationError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ integrations: await listLinkIntegrations(a.user.id) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const a = await admin();
  if ('res' in a) return a.res;
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!(LINK_INTEGRATIONS as readonly string[]).includes(kind)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await disconnectLinkIntegration(a.user.id, kind as LinkIntegrationKey);
  return NextResponse.json({ integrations: await listLinkIntegrations(a.user.id) });
}
