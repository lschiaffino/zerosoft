import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import { parseReportRange } from '@/lib/chat-inbox';
import { exportConversations, exportToCsv } from '@/lib/chat-export';
import { limitWrites } from '@/lib/write-limit';

export const dynamic = 'force-dynamic';

/**
 * Export masivo: ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json[&notes=1][&status=…].
 * JSON trae los mensajes; CSV, una fila por conversación. Tope EXPORT_MAX.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await limitWrites('chat-export', user.actingUser?.id ?? user.id, 10, 60);
  if (limited) return limited;
  const sp = new URL(req.url).searchParams;
  const range = parseReportRange(sp.get('from'), sp.get('to'));
  const status = ['open', 'pending', 'snoozed', 'resolved'].includes(sp.get('status') ?? '') ? sp.get('status')! : undefined;
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const json = sp.get('format') === 'json';
  const list = await exportConversations(
    widgets.map((w) => w.id),
    range,
    { withMessages: json, withNotes: sp.get('notes') === '1', status },
  );
  const name = `chat-conversations-${range.fromDate}-${range.toDate}`;
  if (json) {
    return new NextResponse(JSON.stringify({ range: { from: range.fromDate, to: range.toDate }, conversations: list }, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${name}.json"`,
        'cache-control': 'no-store',
      },
    });
  }
  return new NextResponse(exportToCsv(list), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
