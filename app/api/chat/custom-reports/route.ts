import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { createSavedReport, listSavedReports } from '@/lib/chat-custom-reports';

export const dynamic = 'force-dynamic';

/** Lista; con ?metric=&groupBy=&rangeDays=&widgetId= corre sin guardar. */
export async function GET() {
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const reports = await listSavedReports(s.ws);
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

