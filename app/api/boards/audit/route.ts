import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { boardViewer } from '@/lib/board-access';
import { boardAuditCsv, listBoardAudit } from '@/lib/board-audit';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registro de actividad de Board (solo owner y admins). ?action=&board=&before=&format=csv */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  if (!boardViewer(user).isAdmin) return jsonError(403, 'forbidden');
  const p = new URL(req.url).searchParams;
  const csv = p.get('format') === 'csv';
  const entries = await listBoardAudit(user.id, {
    action: p.get('action'),
    boardId: p.get('board'),
    before: p.get('before'),
    limit: csv ? 1000 : 100,
  });
  if (csv) {
    return new NextResponse(boardAuditCsv(entries), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="board-audit.csv"',
        'cache-control': 'no-store',
      },
    });
  }
  return NextResponse.json({ entries }, { headers: { 'cache-control': 'no-store' } });
}
