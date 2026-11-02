import type { NextRequest } from 'next/server';
import { pjson, readJson, withPeople } from '@/lib/people-http';
import { createSurvey, listSurveys } from '@/lib/people-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: encuestas (resultados solo para HR y con el mínimo de respuestas). POST { question }: HR la abre. */
export async function GET() {
  return withPeople(async (ctx) => pjson({ surveys: await listSurveys(ctx) }));
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ id: await createSurvey(ctx, String((await readJson(req)).question ?? '')) }, 201));
}
