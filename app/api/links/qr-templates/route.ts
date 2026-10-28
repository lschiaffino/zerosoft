import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createQrTemplate, listQrTemplates, qrTemplateSchema } from '@/lib/link-qr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plantillas de QR del workspace (colores, puntos, logo y marco). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ templates: await listQrTemplates(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = qrTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const created = await createQrTemplate(user.id, parsed.data, realUserId(user));
  if (created === 'limit') return NextResponse.json({ error: 'template_limit' }, { status: 409 });
  return NextResponse.json({ template: created }, { status: 201 });
}
