import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getBioSettings, saveBioSettings } from '@/lib/link-bio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().trim().max(80),
  bio: z.string().trim().max(300),
  avatarUrl: z.string().trim().url().regex(/^https:\/\//).max(2000).nullable(),
  published: z.boolean(),
  linkIds: z.array(z.string().max(64)).max(50),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ...(await getBioSettings(user.id)), handle: user.handle });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  await saveBioSettings(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
