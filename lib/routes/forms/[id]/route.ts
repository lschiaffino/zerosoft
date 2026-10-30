import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteForm, getForm, updateForm } from '@/lib/forms/core';
import { fFail, fJson, formsActor, parseBody } from '@/lib/forms/http';
import { FORM_STATUSES, SHARING, settingsSchema } from '@/lib/forms/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const form = await getForm(a.actor, (await params).id);
  return form ? fJson({ form }) : fJson({ error: 'not_found' }, 404);
}

const patchSchema = z.object({
  name: z.string().max(200).optional(),
  slug: z.string().max(62).optional(),
  definition: z.unknown().optional(),
  settings: settingsSchema.partial().optional(),
  sharing: z.enum(SHARING).optional(),
  members: z.array(z.string().max(64)).max(200).optional(),
  status: z.enum(FORM_STATUSES).optional(),
});

/** PATCH: nombre, slug, definición (preguntas, lógica, finales, traducciones), ajustes, acceso y estado. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const input = await parseBody(req, patchSchema);
    const form = await updateForm(a.actor, (await params).id, input);
    return form ? fJson({ form }) : fJson({ error: 'not_found' }, 404);
  } catch (err) {
    return fFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const ok = await deleteForm(a.actor, (await params).id);
    return ok ? fJson({ ok: true }) : fJson({ error: 'not_found' }, 404);
  } catch (err) {
    return fFail(err);
  }
}
