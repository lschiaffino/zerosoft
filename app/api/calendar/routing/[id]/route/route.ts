import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { getRoutingFormBySlug, evaluateRouting, missingRequiredFields } from '@/lib/calendar-routing';
import { routingEvaluateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint público del routing form. El segmento [id] lleva el SLUG del form
 * (el path es /api/calendar/routing/<slug>/route): comparte nombre de segmento
 * con el CRUD admin porque Next exige un solo nombre por posición dinámica.
 */

/** Definición pública del form (sin user_id ni destinos de las reglas). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = await limitByIp(_req, 'routing', 60, 60);
  if (limited) return limited;
  const form = await getRoutingFormBySlug(params.id);
  if (!form) return notFound();
  return NextResponse.json({
    slug: form.slug,
    title: form.title,
    description: form.description,
    fields: form.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      options: f.type === 'select' ? f.optionsParsed : [],
      required: f.required === 1,
    })),
  });
}

/** Evalúa respuestas → { eventTypeSlug } del destino (regla o default). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = await limitByIp(req, 'routing', 30, 60);
  if (limited) return limited;
  const form = await getRoutingFormBySlug(params.id);
  if (!form) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingEvaluateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  if (missingRequiredFields(form, parsed.data.answers).length > 0) {
    return crmError(400, 'invalid_input');
  }

  const eventTypeSlug = await evaluateRouting(form, parsed.data.answers);
  if (!eventTypeSlug) return crmError(404, 'no_route');
  return NextResponse.json({ eventTypeSlug });
}
