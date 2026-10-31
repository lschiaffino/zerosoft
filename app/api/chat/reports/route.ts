import { NextResponse } from 'next/server';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { getCurrentUser } from '@/lib/session';
import { chatReportToCsv, getChatRangeReport, parseReportRange } from '@/lib/chat-inbox';

export const dynamic = 'force-dynamic';

/** Reporte de Chat por rango (?from=YYYY-MM-DD&to=YYYY-MM-DD). ?format=csv descarga CSV. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const range = parseReportRange(sp.get('from'), sp.get('to'));
  const widgets = await listAccessibleChatWidgets(user);
  const report = await getChatRangeReport(widgets.map((w) => w.id), range);
  if (sp.get('format') === 'csv') {
    const csv = chatReportToCsv(report, { unassigned: 'Unassigned', total: 'Total' });
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="chat-report-${range.fromDate}-${range.toDate}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }
  return NextResponse.json({ range: { from: range.fromDate, to: range.toDate }, ...report });
}
