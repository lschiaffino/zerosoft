import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createForm, listForms } from '@/lib/forms/core';
import { fFail, fJson, formsActor, parseBody } from '@/lib/forms/http';
import { FORM_LANGS } from '@/lib/forms/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?q=&status=: formularios que la persona ve. */
export async function GET(req: NextRequest) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  return fJson({ forms: await listForms(a.actor, { q: sp.get('q') ?? undefined, status: sp.get('status') ?? undefined }) });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  template: z.string().max(40).nullish(),
  lang: z.enum(FORM_LANGS).optional(),
});

/** POST: formulario nuevo en borrador (vacío o desde una plantilla, en el idioma pedido). */
export async function POST(req: NextRequest) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const input = await parseBody(req, createSchema);
    return fJson({ form: await createForm(a.actor, { name: input.name, template: input.template ?? null, lang: input.lang }) }, 201);
  } catch (err) {
    return fFail(err);
  }
}
