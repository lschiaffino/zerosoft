import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { ConversionError, trackSale } from '@/lib/link-conversions';
import { roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    /** Cliente registrado antes con /track/lead. */
    customerExternalId: z.string().min(1).max(255).optional(),
    /** O el click directo (venta sin lead previo). */
    clickId: z.string().min(1).max(64).optional(),
    /** En unidades menores (centavos): 4900 = 49,00. */
    amount: z.number().int().min(0).max(1_000_000_000_000),
    currency: z.string().length(3).optional(),
    eventName: z.string().min(1).max(100).optional(),
    /** Id del pago o factura: la misma venta no se cuenta dos veces. */
    invoiceId: z
      .string()
      .min(1)
      .max(255)
      // stripe: y shopify: son de las integraciones: la API no puede pisar (ni adelantar) esas ventas.
      .refine((v) => !/^(stripe|shopify):/i.test(v), 'the stripe: and shopify: prefixes are reserved')
      .optional(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .refine((b) => b.customerExternalId || b.clickId, { message: 'customerExternalId or clickId is required', path: ['customerExternalId'] });

const MESSAGES: Record<string, string> = {
  customer_not_found: 'No lead of this workspace has that customerExternalId. Track the lead first or send the clickId.',
  click_not_found: 'No click of this workspace has that clickId.',
  invalid_amount: 'amount must be a non-negative integer in minor units.',
  invalid_currency: 'currency must be a 3-letter ISO code.',
};

/** Venta atribuida al click que trajo al cliente (como POST /track/sale de Dub). */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'links:write');
  if ('res' in auth) return auth.res;
  const viewer = { id: auth.personId, admin: roleAtLeast(auth.role, 'admin') };
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiError(400, 'invalid_input', issue?.message && issue.path.length ? `Invalid "${issue.path.join('.')}": ${issue.message}.` : 'Invalid body.');
  }
  const b = parsed.data;
  try {
    const { conversion, duplicate } = await trackSale(auth.user.id, {
      customerExternalId: b.customerExternalId ?? null,
      clickId: b.clickId ?? null,
      amount: b.amount,
      currency: b.currency,
      eventName: b.eventName,
      invoiceId: b.invoiceId ?? null,
      metadata: b.metadata ?? null,
      viewer,
    });
    return NextResponse.json({ sale: conversion, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof ConversionError) return apiError(err.status, err.code, MESSAGES[err.code] ?? 'The sale could not be tracked.');
    throw err;
  }
}
