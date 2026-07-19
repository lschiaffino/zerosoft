import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { searchDocPages } from '@/lib/docs';
import { unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const rows = q.trim().length > 0 ? await searchDocPages(user.id, q) : [];
  return NextResponse.json({ rows, q });
}
