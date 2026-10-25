import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { searchDocPages, searchDocPagesContent, searchDocRows, searchSharedDocPages } from '@/lib/docs';
import { unauthorized } from '@/lib/docs-http';
import { docsHidden } from '@/lib/docs-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const q = req.nextUrl.searchParams.get('q') ?? '';
  // Teamspaces cerrados o privados de los que no es miembro: no aparecen.
  const hide = await docsHidden(user);
  // content=1 (switcher Cmd+P): también busca en el texto de los bloques y
  // devuelve el fragmento. Sin el flag (links `[[`): solo por título.
  if (req.nextUrl.searchParams.get('content') === '1') {
    // Más lo compartido desde otros workspaces (un invitado no tiene páginas propias).
    const [own, shared] = q.trim().length > 0 ? await Promise.all([searchDocPagesContent(user.id, q, 20, hide), searchSharedDocPages(user, q, 10)]) : [[], []];
    const seen = new Set(own.map((h) => h.id));
    const rows = [...own, ...shared.filter((h) => !seen.has(h.id))];
    return NextResponse.json({ rows, q });
  }
  // Páginas y, después, filas de bases (link a una fila: row_id).
  const [pages, dbRows] =
    q.trim().length > 0 ? await Promise.all([searchDocPages(user.id, q, hide), searchDocRows(user.id, q, 10, hide)]) : [[], []];
  const rows = [...pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon })), ...dbRows];
  return NextResponse.json({ rows, q });
}
