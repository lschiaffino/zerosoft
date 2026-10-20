import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createUtmTemplate, listUtmTemplates, utmTemplateSchema } from '@/lib/link-utm-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ templates: await listUtmTemplates(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = utmTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const empty = parsed.error.issues.some((i) => i.message === 'empty_template');
    return NextResponse.json({ error: empty ? 'empty_template' : 'bad_request' }, { status: 400 });
  }
  const result = await createUtmTemplate(user.id, parsed.data, realUserId(user));
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: result.code === 'name_taken' ? 409 : 400 });
  return NextResponse.json(result.template, { status: 201 });
}
