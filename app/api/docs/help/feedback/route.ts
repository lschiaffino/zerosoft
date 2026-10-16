import { NextResponse } from 'next/server';
import { z } from 'zod';
import { limitByIp } from '@/lib/rate-limit';
import { recordHelpFeedback } from '@/lib/docs-help';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  pageId: z.string().trim().min(1).max(64),
  helpful: z.boolean(),
  voter: z.string().trim().min(8).max(64).optional(),
});

/** "¿Te sirvió?" del centro de ayuda (público, sin login). */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'help-feedback', 20, 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const ok = await recordHelpFeedback(parsed.data.pageId, parsed.data.helpful, parsed.data.voter);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
