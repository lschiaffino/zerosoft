import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { ConversionError, trackLead } from '@/lib/link-conversions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  /** El ?zs_id= que llegó al destino (o la cookie zs_id del script). */
  clickId: z.string().min(1).max(64),
  /** Nombre del evento ("Sign up", "Demo request"…). Default "Sign up". */
  eventName: z.string().min(1).max(100).optional(),
  /** Id del cliente en tu sistema: con él se atribuyen después las ventas. */
  customerExternalId: z.string().min(1).max(255),
  customerName: z.string().max(200).nullish(),
  customerEmail: z.string().email().max(254).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

const MESSAGES: Record<string, string> = {
  click_not_found: 'No click of this workspace has that clickId. Turn on conversion tracking on the link.',
  invalid_customer: 'customerExternalId is required.',
};

/** Lead atribuido a un click (como POST /track/lead de Dub). Idempotente por cliente + evento. */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'body';
    return apiError(400, 'invalid_input', `Invalid "${field}".`);
  }
  const b = parsed.data;
  try {
    const { conversion, duplicate } = await trackLead(auth.user.id, {
      clickId: b.clickId,
      eventName: b.eventName,
      customer: { externalId: b.customerExternalId, name: b.customerName, email: b.customerEmail },
      metadata: b.metadata ?? null,
    });
    return NextResponse.json({ lead: conversion, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof ConversionError) return apiError(err.status, err.code, MESSAGES[err.code] ?? 'The lead could not be tracked.');
    throw err;
  }
}
