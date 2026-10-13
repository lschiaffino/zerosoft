import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { createEmailTemplate, listEmailTemplates } from '@/lib/crm-email';
import { templateCreateSchema } from '@/lib/crm-email-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Templates y snippets compartidos del workspace (todos los miembros los usan). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const kind = req.nextUrl.searchParams.get('kind');
  const templates = await listEmailTemplates(
    user.id,
    kind === 'template' || kind === 'snippet' ? kind : undefined,
  );
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = templateCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const template = await createEmailTemplate(user.id, realUserId(user), parsed.data);
  return NextResponse.json(template, { status: 201 });
}
