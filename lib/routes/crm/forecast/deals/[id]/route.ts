import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { FORECAST_CATEGORIES, setDealForecastCategory } from '@/lib/crm-forecast';
import { guardRecord, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ category: z.union([z.enum(FORECAST_CATEGORIES), z.literal('')]) });

/** Categoría de forecast de un deal ('' = la de su etapa). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const denied = await guardRecord(user.id, 'deal', id, await sessionScope(user));
  if (denied) return denied;
  const ok = await setDealForecastCategory(user.id, id, parsed.data.category, user.actingUser?.email ?? user.email);
  return ok ? NextResponse.json({ ok: true, category: parsed.data.category }) : notFound();
}
