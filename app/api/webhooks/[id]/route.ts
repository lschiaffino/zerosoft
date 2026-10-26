import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteWebhook, updateWebhook, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { MAX_FILTER_VALUES, normalizeCrmFilter } from '@/lib/webhooks-events';
import { UnsafeUrlError } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  active: z.boolean().optional(),
  url: z.string().trim().url().max(2000).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  /** Propiedades de *.property_changed; [] = todas. */
  properties: z.array(z.string().trim().max(80)).max(MAX_FILTER_VALUES).optional(),
});

/** Pausa/reanuda o cambia URL, eventos y propiedades de un webhook. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { properties, ...rest } = parsed.data;
  try {
    const ok = await updateWebhook(
      user.id,
      id,
      {
        ...rest,
        ...(properties !== undefined ? { crmFilter: normalizeCrmFilter({ properties }) } : {}),
      },
      user.actingUser?.id ?? user.id,
    );
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnsafeUrlError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await deleteWebhook(user.id, id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
