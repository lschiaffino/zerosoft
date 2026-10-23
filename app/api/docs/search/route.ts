import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { searchDocPages, searchDocPagesContent, searchDocRows } from '@/lib/docs';
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
  // Páginas y, después, filas de bases (link a una fila: row_id).
  const [pages, dbRows] = q.trim().length > 0 ? await Promise.all([searchDocPages(user.id, q), searchDocRows(user.id, q)]) : [[], []];
  const rows = [...pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon })), ...dbRows];
  return NextResponse.json({ rows, q });
}
