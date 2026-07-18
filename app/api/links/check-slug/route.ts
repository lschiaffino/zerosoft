import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { slugExists } from '@/lib/links';
import { isValidSlug } from '@/lib/reserved';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const slug = (req.nextUrl.searchParams.get('slug') ?? '').trim();
  if (!slug) return NextResponse.json({ slug, valid: false, available: false });

  const valid = isValidSlug(slug);
  return NextResponse.json({ slug, valid, available: valid && !(await slugExists(slug)) });
}
