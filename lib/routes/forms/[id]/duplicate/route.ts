import { NextRequest } from 'next/server';
import { duplicateForm } from '@/lib/forms/core';
import { fFail, fJson, formsActor } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST: copia en borrador (sin respuestas, webhook ni avisos ajenos). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const form = await duplicateForm(a.actor, (await params).id);
    return form ? fJson({ form }, 201) : fJson({ error: 'not_found' }, 404);
  } catch (err) {
    return fFail(err);
  }
}
