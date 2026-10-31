import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, hiddenWidgetIds, readBody } from '@/lib/chat-http';
import { createSavedReport, listSavedReports } from '@/lib/chat-custom-reports';

export const dynamic = 'force-dynamic';

/** Los reportes guardados, salvo los atados a una bandeja que esta persona no ve. */
export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const hidden = await hiddenWidgetIds(s);
  const reports = (await listSavedReports(s.ws)).filter((r) => !r.widget_id || !hidden.has(r.widget_id));
  return NextResponse.json({ reports });
}

export async function POST(req: Request) {
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  if (typeof body.widget_id === 'string' && body.widget_id && !s.widgets.some((w) => w.id === body.widget_id)) return chatError(400, 'invalid_input');
  try {
    return NextResponse.json(await createSavedReport(s.ws, s.me, body), { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}

