import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getBioSettings, saveBioSettings } from '@/lib/link-bio';
import { ACCENT_RE, BIO_THEMES } from '@/lib/link-bio-theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().trim().max(80),
  bio: z.string().trim().max(300),
  avatarUrl: z.string().trim().url().regex(/^https:\/\//).max(2000).nullable(),
  published: z.boolean(),
  linkIds: z.array(z.string().max(64)).max(50),
  theme: z.enum(BIO_THEMES).default('auto'),
  accent: z.string().regex(ACCENT_RE).nullable().default(null),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ...(await getBioSettings(user.id)), handle: user.handle });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // La página pública es la del owner (/@handle): publicarla o reescribirla es de admins.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await saveBioSettings(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
