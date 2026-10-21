import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import {
  answerParams,
  getPublicRoutingForm,
  logRoutingSubmission,
  missingRequiredFields,
  routeAnswers,
  withParams,
} from '@/lib/calendar-routing';
import { getUserById } from '@/lib/db';
import { routingEvaluateSchema } from '@/lib/calendar-schema';
import { invalidBody, notFound, crmError } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Endpoint público del routing form: /api/calendar/routing/<form id>/route. */

/** Definición pública del form (sin user_id ni destinos de las reglas). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = await limitByIp(_req, 'routing', 60, 60);
  if (limited) return limited;
  const form = await getPublicRoutingForm(params.id);
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

/**
 * Evalúa respuestas → destino (regla o respaldo) y registra el envío:
 * { kind: 'event', eventTypeSlug, bookPath } | { kind: 'url', url } |
 * { kind: 'message', message }. Con "pasar respuestas", van como parámetros
 * del link de reserva (prellenan las preguntas con el mismo nombre) o de la URL.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const limited = await limitByIp(req, 'routing', 30, 60);
  if (limited) return limited;
  const form = await getPublicRoutingForm(params.id);
  if (!form) return notFound();

  const body: unknown = await req.json().catch(() => null);
  const parsed = routingEvaluateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  if (missingRequiredFields(form, parsed.data.answers).length > 0) {
    return crmError(400, 'invalid_input');
  }

  const outcome = await routeAnswers(form, parsed.data.answers);
  const owner = outcome?.kind === 'event' ? await getUserById(form.user_id) : null;
  const usable = outcome && (outcome.kind !== 'event' || owner?.handle) ? outcome : null;
  await logRoutingSubmission(form, parsed.data.answers, usable);
  if (!usable) return crmError(404, 'no_route');
  const passed = form.pass_answers === 1 ? answerParams(form, parsed.data.answers) : [];
  if (usable.kind === 'message') return NextResponse.json({ kind: 'message', message: usable.message });
  if (usable.kind === 'url') return NextResponse.json({ kind: 'url', url: withParams(usable.url, passed) });
  return NextResponse.json({
    kind: 'event',
    eventTypeSlug: usable.slug,
    bookPath: withParams(`/book/${owner!.handle}/${usable.slug}`, passed),
  });
}
