import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { searchDocPages, searchDocPagesContent } from '@/lib/docs';
import { unauthorized } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const q = req.nextUrl.searchParams.get('q') ?? '';
  // content=1 (switcher Cmd+P): también busca en el texto de los bloques y
  // devuelve el fragmento. Sin el flag (links `[[`): solo por título.
  if (req.nextUrl.searchParams.get('content') === '1') {
    const rows = q.trim().length > 0 ? await searchDocPagesContent(user.id, q) : [];
    return NextResponse.json({ rows, q });
  }
  const rows = q.trim().length > 0 ? await searchDocPages(user.id, q) : [];
  return NextResponse.json({ rows, q });
}
