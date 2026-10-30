import { NextRequest } from 'next/server';
import { createTemplate, listTemplates, templateSchema } from '@/lib/hiring/comms';
import { TEMPLATE_KINDS, type TemplateKind } from '@/lib/hiring/types';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const kind = req.nextUrl.searchParams.get('kind');
  return hJson({ templates: await listTemplates(a.actor.ws, kind && (TEMPLATE_KINDS as readonly string[]).includes(kind) ? (kind as TemplateKind) : undefined) });
}

export async function POST(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson({ template: await createTemplate(a.actor, await parseBody(req, templateSchema)) }, 201);
  } catch (err) {
    return hFail(err);
  }
}
